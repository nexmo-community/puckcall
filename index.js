const express = require('express')
const app = express()
var bodyParser = require('body-parser');
app.use(bodyParser.json());
var expressWs = require('express-ws')(app);
var isBuffer = require('is-buffer')

var header = require("waveheader");
var fs = require('fs');
var file;

var tone = require('tonegenerator')

var mic = require('mic');
const Speaker = require('speaker');
var speaker = new Speaker({
                  channels: 1,          
                  bitDepth: 16,         
                  sampleRate: 16000});

var chunkingStreams = require('chunking-streams');
var SizeChunker = chunkingStreams.SizeChunker;
var config = require("./config.json")

var micInstance = mic({
    rate: '16000',
    channels: 1
});
var chunker = new SizeChunker({
    chunkSize: 640 // must be a number greater than zero. 
});

var micInputStream = micInstance.getAudioStream();
micInputStream.pipe(chunker);
micInstance.start();
micInstance.pause();


var ngrok = require('ngrok');
var ngrokurl;

ngrok.once('connect', function (url) {
    ngrokurl = url;
    console.log("Ngrok connected as: ", ngrokurl);
});
ngrok.connect({ addr: 8000,
                region: 'eu'});



var Nexmo = require('nexmo');
var app_id = config.app_id
var nexmo = new Nexmo({
    apiKey: "dummy",
    apiSecret: "dummy",
    applicationId: app_id,
    privateKey: "./private.key",
  });


function makeCall(){
    var url = ngrokurl+"/ncco"
    nexmo.calls.create({
      to: [{
        type: 'phone',
          number: config.dest
      }],
      from: {
        type: 'phone',
          number: config.callerid
      },
      answer_url: [url]
    }, function(resp){
        console.log("Calling",  config.dest );
    });
}



//Serve a Main Page
app.get('/', function(req, res) {
    res.send("Puckcall");
});

app.get('/call', function(req, res) {
    makeCall();
    res.send("Calling");
});

//Serve the NCCO on the /ncco answer URL
app.get('/ncco', function(req, res) {
    var ncco = require('./ncco.json');
    //ncco[1]['endpoint'][0]['uri'] = "wss:"+ngrokurl.split(":")[1]+"/socket" //Bug with SSL Webscockets
    ncco[1]['endpoint'][0]['uri'] = "ws:"+ngrokurl.split(":")[1]+"/socket"
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(ncco), 'utf-8');
});


var buf;
function wssend(ws, data){
    if (data.length == 640){
        //console.log(Date.now(), " Sending: ", data.length, " Bytes")
        try {
           ws.send(data);
        }
        catch (e) {
        console.log("Send Error: ", e)
        };
    }
    else{
        //console.log(Date.now(), " Buffering: ", data.length, " Bytes");
        buf += data;
        if (buf.length == 640){
            //console.log(Date.now(), " Sending: ", data.length, " Bytes")
            try {
               ws.send(data);
            }
            catch (e) {
            console.log("Send Error: ", e)
            };
            buf = null;
        }
    }
    
}   

// Handle the Websocket
app.ws('/socket', function(ws, req) {
    console.log("Websocket Connected");
    var speaker = new Speaker({
                  channels: 1,          
                  bitDepth: 16,         
                  sampleRate: 16000});
    setTimeout(function(){  micInstance.resume(); }, 2000);
    chunker.on('data', function(chunk) {
        wssend(ws, chunk.data);
    });
    ws.on('message', function(msg) {
     if (isBuffer(msg)) {
         try {
            speaker.write(msg);        
         }
         catch (e) {
             console.log("Speaker Error: ", e)
         }
             
     }
     else {
         console.log(msg);
         var tonedata = tone(440, .8, volume = tone.MAX_16, sampleRate = 16000)
         var i,j,sample,chunk = 640;
         for (i=0,j=tonedata.length; i<j; i+=chunk) {
             sample = tonedata.slice(i,i+chunk);
             wssend(ws, sample);
         }
     }
    });
    ws.on('close', function(ws){
      console.log("Websocket Closed");
      chunker.removeListener('data', chunker.listeners('data')[0]);
      micInstance.pause();
      speaker.end();
  })
});

 

app.listen(8000, () => console.log('App listening on port 8000!'))
