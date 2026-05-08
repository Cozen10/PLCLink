import net from 'net';

class PLC {
    Host: string;
    Port: number;
    Unit: number;
    Protocol: string;
    connectOpts;

    constructor({ host, port = 502, unit = 1, protocol = "modbus" }: { host: string, port?: number, unit?: number, protocol?: string }) {
        this.Host = host;
        this.Port = port;
        this.Unit = unit;
        this.Protocol = protocol;
        this.connectOpts = {"host": this.Host,"port": this.Port};
    };

    Socket = new net.Socket;
    PendingReads = new Map<number, Function>();

    connect() {
        this.Socket.connect(this.connectOpts, async () => {
            this.Socket.on('data', (data: Buffer) => {
                const TransactionId = data.readUint16BE(0);
                const Resolve = this.PendingReads.get(TransactionId);
                
                let RegistersValues: number[] = [];
                
                const NumberOfBytes = data.readInt8(8);
                let Register = 0;
                
                for (let CurrentOffset = 9; CurrentOffset < 9 + NumberOfBytes; CurrentOffset += 2) {
                    const Value = data.readUInt16BE(CurrentOffset);
                    
                    RegistersValues[Register++] = Value;
                };

                if (Resolve) {
                    Resolve({ Data: data, Registers: RegistersValues });
                    this.PendingReads.delete(TransactionId)
                };
            });
        });
    };

    private async readRegisters(registers: number | number[], functionCode: number) {
        let CollectiveData: Record<number, Promise<any>> = {};

        if (!(Array.isArray(registers))) registers = [registers];

        for (const register of registers) {
            CollectiveData[register] = new Promise((resolve) => {
                const TransactionId = Math.floor(Math.random() * 65535);
            
                let buffer = Buffer.alloc(12);
                buffer.writeUInt16BE(TransactionId, 0);
                buffer.writeUInt16BE(0x0000, 2);
                buffer.writeUInt16BE(0x0006, 4);
                buffer.writeUInt8(this.Unit, 6);
            
                buffer.writeUint8(functionCode, 7);
                
                buffer.writeUint16BE(register, 8);
                buffer.writeUInt16BE(0x0001, 10);
            
                this.PendingReads.set(TransactionId, resolve)
        
                this.Socket.write(buffer);
            });
        };
        
        let Values: Promise<any>[] = [];

        for (const Entry of Object.entries(CollectiveData)) {
            Values.push(Entry[1]);
        };

        const CleanValues = await Promise.all(Values);
        let CleanData: Record<number, any> = {};

        let Count = 0
        for (const register of registers) {
            CleanData[register] = CleanValues[Count]
            Count++;
        };

        return CleanData;
    };

    async read(registers: number | number[]) {
        return await this.readRegisters(registers, 0x03)
    };

    async readInput(registers: number | number[]) {
        return await this.readRegisters(registers, 0x04)
    };

    write(register: number, value: number) {
        const TransactionId = Math.floor(Math.random() * 65535);

        let buffer = Buffer.alloc(12);
        buffer.writeUInt16BE(TransactionId, 0);
        buffer.writeUInt16BE(0x0000, 2);
        buffer.writeUInt16BE(0x0006, 4);
        buffer.writeUInt8(this.Unit, 6);

        buffer.writeUint8(0x06, 7);
        
        buffer.writeUint16BE(register, 8)
        buffer.writeUint16BE(value, 10)

        this.Socket.write(buffer);
    };
};

(async () => {
    const plc = new PLC({ host: "127.0.0.1" });
    plc.connect();
    plc.write(1, 54)

    const data = await plc.read(1);
    console.log(data);
})();

export default PLC