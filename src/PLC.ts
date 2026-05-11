import net from 'net';

/**
 * The connection to a PLC device over network.
 * Supports multiple industrial protocols (Modbus by default)
 * @param options.host - The IP address of the PLC
 * @param options.port - The port to connect to (default: 502)
 * @param options.protocol - The protocol to use (default: "modbus")
 * @param options.unit - The unit ID of the PLC (default: 1)
 * @example
 * const plc = new PLC({ host: "127.0.0.1" });
 * await plc.connect();
 * console.log(await plc.read(1))
 */
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
    PendingWrites = new Map<number, Function>();

    SavedBuffer: Buffer = Buffer.alloc(0);

    ImportedProtocol!: { readAddress: Function, writeAddress: Function, onData: Function };

    /**
     * Connects to the PLC and loads the protocol driver.
     * Must be awaited before calling any read/write methods.
     * @returns A boolean for the status of the connection
     * @example
     * await plc.connect();
     */
    async connect() {
        return await new Promise((resolve) => {
            this.Socket.connect(this.connectOpts, async () => {
                this.ImportedProtocol = await import(`./protocols/${this.Protocol}.js`);

                this.Socket.on('data', (data: Buffer) => {
                    this.ImportedProtocol.onData(this, data);
                });

                resolve(true)
            });
        });
    };

    /**
     * Reads Holding Registers' values from the connected PLC.
     * Must have connected using `.connect()` in order to use this.
     * @param registers - The addresses of the holding register to read from
     * @returns A record of register addresses to their values
     * @example
     * await plc.read(1);
     * // { '1': { Data: Buffer, AddressValues: [54] }}
     * @example
     * await plc.read([1,6,4])
     * // { '1': { Data: Buffer, AddressValues: [54] }, '6': { Data: Buffer, AddressValues: [23] }, '4': { Data: Buffer, AddressValues: [11] } }
     */
    async read(registers: number | number[]) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");

        return await this.ImportedProtocol.readAddress(this, registers, 0x03);
    };


    /**
     * Reads Input Registers' values from the connected PLC.
     * Input registers are read-only. Must have connected using `.connect()` in order to use this.
     * @param registers - The addresses of the input registers to read from
     * @returns A record of register addresses to their values
     * @example
     * await plc.readInputs(1);
     * // { '1': { Data: Buffer, AddressValues: [54] } }
     * @example
     * await plc.readInputs([1, 6, 4]);
     * // { '1': { Data: Buffer, AddressValues: [54] }, '6': { Data: Buffer, AddressValues: [23] }, '4': { Data: Buffer, AddressValues: [11] } }
     */
    async readInputs(registers: number | number[]) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");
        return await this.ImportedProtocol.readAddress(this, registers, 0x04);
    };

    /**
     * Reads Coil values from the connected PLC.
     * Coils are digital outputs and can be read and written. Must have connected using `.connect()` in order to use this.
     * @param coils - The addresses of the coils to read from
     * @returns A record of coil addresses to their values
     * @example
     * await plc.readCoils(1);
     * // { '1': { Data: Buffer, AddressValues: [1] } }
     * @example
     * await plc.readCoils([1, 6, 4]);
     * // { '1': { Data: Buffer, AddressValues: [1] }, '6': { Data: Buffer, AddressValues: [0] }, '4': { Data: Buffer, AddressValues: [1] } }
     */
    async readCoils(coils: number | number[]) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");
        return await this.ImportedProtocol.readAddress(this, coils, 0x01);
    };

    /**
     * Reads Discrete Input values from the connected PLC.
     * Discrete inputs are read-only digital inputs. Must have connected using `.connect()` in order to use this.
     * @param discreteInputs - The addresses of the discrete inputs to read from
     * @returns A record of discrete input addresses to their values
     * @example
     * await plc.readDiscreteInputs(1);
     * // { '1': { Data: Buffer, AddressValues: [1] } }
     * @example
     * await plc.readDiscreteInputs([1, 6, 4]);
     * // { '1': { Data: Buffer, AddressValues: [1] }, '6': { Data: Buffer, AddressValues: [0] }, '4': { Data: Buffer, AddressValues: [1] } }
     */
    async readDiscreteInputs(discreteInputs: number | number[]) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");
        return await this.ImportedProtocol.readAddress(this, discreteInputs, 0x02);
    };

    /**
     * Writes a number value to a Holding Register on the connected PLC.
     * Must have connected using `.connect()` in order to use this.
     * @param register - The address of the holding register to write to
     * @param value - The numeric value to write
     * @returns A promise that resolves with the write confirmation from the PLC.
     * @example
     * await plc.write(1, 54);
     * // { Status: 'success', Content: { Address: 1, Value: 54 } }
     * @example
     * await plc.write(5, 1083);
     * // { Status: 'success', Content: { Address: 5, Value: 1083 } }
     */
    async write(register: number, value: number) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");

        return await this.ImportedProtocol.writeAddress(this, register, value, 0x06)
    };

    /**
     * Writes a boolean value to a coil on the connected PLC.
     * Must have connected using `.connect()` in order to use this.
     * @param coil - The address of the coil to write to
     * @param value - The boolean value to write
     * @returns A promise that resolves with the write confirmation from the PLC.
     * @example
     * await plc.writeCoil(1, true);
     * // { Status: 'success', Content: { Address: 1, Value: 65280 } }
     * @example
     * await plc.writeCoil(3, false);
     * // { Status: 'success', Content: { Address: 3, Value: 0 } }
     * @example
     * await plc.writeCoil(4, 0xFF00);
     * // { Status: 'success', Content: { Address: 4, Value: 65280 } }
     */
    async writeCoil(coil: number, value: boolean | number) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");

        const BooleanToHex = value ? 0xFF00 : 0x0000;
        return await this.ImportedProtocol.writeAddress(this, coil, BooleanToHex, 0x05)
    };
};

export default PLC