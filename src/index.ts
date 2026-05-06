import net from 'net';

const socket = new net.Socket;
const connectOpts = {
    "host": "127.0.0.1",
    "port": 502
};

socket.connect(connectOpts, () => {
    console.log("Connected");
    read(socket, 1);
});

function read(socketObj: net.Socket, register: number) {
    const TransactionId = Math.floor(Math.random() * 65535);

    let buffer = Buffer.alloc(12);
    buffer.writeUInt16BE(TransactionId, 0);
    buffer.writeUInt16BE(0x0000, 2);
    buffer.writeUInt16BE(0x0006, 4);
    buffer.writeUInt8(0x01, 6);

    buffer.writeUint8(0x03, 7);
    buffer.writeUint16BE(register, 8);
    buffer.writeUInt16BE(0x0001, 10);

    console.log(buffer);
    socketObj.write(buffer);

    socketObj.on('data', (data: Buffer) => {
        if (data.readInt16BE(0) != buffer.readInt16BE(0)) return
        console.log(data);

        let RegistersValues: number[] = [];

        const NumberOfBytes = data.readInt8(8);
        let Register = 0;

        for (let CurrentOffset = 9; CurrentOffset < 9 + NumberOfBytes; CurrentOffset += 2) {
            const Value = data.readUInt16BE(CurrentOffset);

            RegistersValues[Register++] = Value;
        };

        return { Data: data, Registers: RegistersValues };
    });
};