import net from 'net';

const socket = new net.Socket;
const connectOpts = {
    "host": "127.0.0.1",
    "port": 502
};

socket.connect(connectOpts, () => {
    console.log("Connected");
});