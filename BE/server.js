// Use the websocket-relay to serve a raw MPEG-TS over WebSockets. You can use
// ffmpeg to feed the relay. ffmpeg -> websocket-relay -> browser
// Example:
// node websocket-relay yoursecret 8081 8082
// ffmpeg -i <some input> -f mpegts http://localhost:8081/yoursecret

var fs = require('fs'),
	http = require('http'),
	WebSocket = require('ws');

if (process.argv.length < 3) {
	console.log(
		'Usage: \n' +
		'node websocket-relay.js <secret> [<stream-port> <websocket-port>]'
	);
	process.exit();
}

var STREAM_SECRET = process.argv[2],
	STREAM_PORT = process.argv[3] || 8081,
	WEBSOCKET_PORT = process.argv[4] || 8082,
	RECORD_STREAM = false;

// Websocket Server
var socketServer = new WebSocket.Server({ port: WEBSOCKET_PORT, perMessageDeflate: false });
socketServer.connectionCount = 0;
socketServer.on('connection', function (socket, upgradeReq) {
	socketServer.connectionCount++;
	console.log(
		'New WebSocket Connection: ',
		(upgradeReq || socket.upgradeReq).socket.remoteAddress,
		(upgradeReq || socket.upgradeReq).headers['user-agent'],
		'(' + socketServer.connectionCount + ' total)'
	);
	socket.on('close', function (code, message) {
		socketServer.connectionCount--;
		console.log(
			'Disconnected WebSocket (' + socketServer.connectionCount + ' total)'
		);
	});
});
socketServer.broadcast = function (data) {
	socketServer.clients.forEach(function each(client) {
		if (client.readyState === WebSocket.OPEN) {
			client.send(data);
		}
	});
};

// HTTP Server to accept incomming MPEG-TS Stream from ffmpeg
var streamServer = http.createServer(function (request, response) {
	var params = request.url.substr(1).split('/');

	if (params[0] !== STREAM_SECRET) {
		console.log(
			'Failed Stream Connection: ' + request.socket.remoteAddress + ':' +
			request.socket.remotePort + ' - wrong secret.'
		);
		response.end();
	}

	response.connection.setTimeout(0);
	console.log(
		'Stream Connected: ' +
		request.socket.remoteAddress + ':' +
		request.socket.remotePort
	);
	request.on('data', function (data) {
		socketServer.broadcast(data);
		if (request.socket.recording) {
			request.socket.recording.write(data);
		}
	});
	request.on('end', function () {
		console.log('close');
		if (request.socket.recording) {
			request.socket.recording.close();
		}
	});

	// Record the stream to a local file?
	if (RECORD_STREAM) {
		var path = 'recordings/' + Date.now() + '.ts';
		request.socket.recording = fs.createWriteStream(path);
	}
}).listen(STREAM_PORT);

console.log('Listening for incomming MPEG-TS Stream on http://127.0.0.1:' + STREAM_PORT + '/<secret>');
console.log('Awaiting WebSocket connections on ws://127.0.0.1:' + WEBSOCKET_PORT + '/');


var cmd = 'ffmpeg';
var args = '-re -i 2.mp4 -f mpegts -codec:v \
mpeg1video -s 860x480 -b:v 1500k -r 30 -bf 0 \
-codec:a mp2 -ar 44100 -ac 1 -b:a 128k \
-muxdelay 0.1 \
http://127.0.0.1:8081/duy'.split(' ');
var child = require('child_process');
var ffmpeg = child.spawn(cmd, args);
ffmpeg.on('data', function (data) {
	// console.log('Data ---->>>'+ data)
})
// detect if ffmpeg was not spawned correctly
ffmpeg.stderr.on('data', function (data) {
	if (/^execvp\(\)/.test(data)) {
		console.log('failed to start ' + argv.ffmpeg);
		process.exit(1);
	}
});
ffmpeg.on('exit', function (code) {
	if (code != null) {
		console.log('FFmpeg error, exit code ' + code);
	}
	process.exit();
});
