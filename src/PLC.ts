import net from 'net';
import EventEmitter from 'events';
import Watcher from './Watcher.js';
import { ImportedProtocol } from './Types.js';

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
class PLC extends EventEmitter {
    Host: string;
    Port: number;
    Unit: number;
    Protocol: string;
    connectOpts;

    MaxRetries: number;
    RetryDelay: number;
    isConnected: boolean = false;
    isReconnecting: boolean = false;
    hasConnectedBefore: boolean = false;
    intenionalDisconnect: boolean = false;

    constructor({ host, port = 502, unit = 1, protocol = "modbus", maxRetries = 10, retryDelay = 5000 }: { host: string, port?: number, unit?: number, protocol?: string, maxRetries?: number, retryDelay?: number }) {
        super()

        this.Host = host;
        this.Port = port;
        this.Unit = unit;
        this.MaxRetries = maxRetries
        this.RetryDelay = retryDelay
        this.Protocol = protocol;
        this.connectOpts = {"host": this.Host,"port": this.Port};
    };

    Socket = new net.Socket;
    PendingReads = new Map<number, Function>();
    PendingWrites = new Map<number, Function>();

    private queue: { 
        execute: () => Promise<void>; 
        resolve: (val: any) => void; 
        reject: (err: any) => void; 
    }[] = [];
    private isProcessingQueue = false;

    SavedBuffer: Buffer = Buffer.alloc(0);

    ImportedProtocol!: ImportedProtocol;

    private async handleAutoReconnect() {
        if (this.isReconnecting) return;
        if (!this.hasConnectedBefore) return;

        this.isReconnecting = true

        this.emit("disconnect");
        console.warn(`PLC disconnected. Starting auto-reconnect...`);
        
        const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
        for (let currentRetries = 1; currentRetries <= this.MaxRetries; currentRetries++) {
            try {
                console.log(`Connection attempt ${currentRetries}/${this.MaxRetries}...`);

                await this.connect(); 
                
                console.log("Successfully reconnected to PLC");
                this.isReconnecting = false;

                return;
            } catch (error) {
                this.emit("error", error)
                console.warn(`Retry ${currentRetries} failed. Auto-retrying in ${this.RetryDelay / 1000} seconds...`);

                if (currentRetries === this.MaxRetries) {
                    this.emit("death");
                    console.error("Max retries reached. PLC connection marked as permanently dead");
                    this.isReconnecting = false;

                    return;
                };

                await delay(this.RetryDelay);
            };
        };
    };

    private async processNextQueueItem() {
        if (this.isProcessingQueue || this.queue.length === 0) return;

        this.isProcessingQueue = true;
        const item = this.queue.shift()!;

        try {
            const result = await item.execute();
            item.resolve(result);
        } catch (error) {
            item.reject(error);
        } finally {
            this.isProcessingQueue = false;
            this.processNextQueueItem();
        }
    }

    /**
     * Connects to the PLC and loads the protocol driver.
     * Must be awaited before calling any read/write methods.
     * @returns A boolean for the status of the connection
     * @example
     * await plc.connect();
     */
    async connect() {
        if (this.isConnected) return;
        this.Socket.removeAllListeners('close');
        this.Socket.once('close', (hadError: boolean) => {
            this.isConnected = false
            if (this.intenionalDisconnect) {
                this.intenionalDisconnect = false;
                return;
            };

            this.handleAutoReconnect();
        });

        return await new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.emit("error", new Error("PLC_CONNECTION_TIMEOUT"))
                reject("Connection Timedout");
                this.Socket.removeAllListeners('close');
                this.Socket.destroy();

                return;
            }, 5000);
            this.Socket.once('error', (error) => {
                if (this.Socket.destroyed) return;
                this.emit("error", error)
                clearTimeout(timer);
                reject(error);
                
                return;
            });
            this.Socket.connect(this.connectOpts, async () => {
                if (this.Socket.destroyed) return;
                this.Socket.removeAllListeners('error');
                clearTimeout(timer);
                
                try {
                    this.ImportedProtocol = await import(`./protocols/${this.Protocol}.js`);
                } catch (error) {
                    reject(error);
                    this.Socket.destroy();

                    return;
                };

                this.Socket.removeAllListeners('data');

                this.hasConnectedBefore = true
                this.isConnected = true

                this.Socket.on('data', (data: Buffer) => {
                    this.ImportedProtocol.onData(this, data);
                });

                if (this.isReconnecting) {
                    this.emit("reconnect");
                } else {
                    this.emit("connect");
                }

                resolve(true);
            });
        });
    };

    /**
     * Cleanly closes/disconnects the connection between itself and the PLC.
     * @example
     * plc.disconnect();
     */
    disconnect() {
        this.intenionalDisconnect = true;
        return this.ImportedProtocol.disconnect(this).then((result: any) => {
            this.emit("disconnect");
            console.log("PLC disconnected");
        }).catch((err: Error) => {
            this.intenionalDisconnect = false;
            this.emit("error", err)
            console.warn(err);
        });
    }

    /**
     * Reads Holding Registers' values from the connected PLC.
     * @requires Must have connected using {@link connect} in order to use this.
     * @param registers - The addresses of the holding register to read from
     * @returns A record of register addresses to their values
     * @example
     * await plc.read(1);
     * // { '1': { Data: Buffer, AddressValues: [54] }}
     * @example
     * await plc.read([1,6,4])
     * // { '1': { Data: Buffer, AddressValues: [54] }, '6': { Data: Buffer, AddressValues: [23] }, '4': { Data: Buffer, AddressValues: [11] } }
     */
    async read(registers: number | string | (number | string)[], timeout: number = 2500) {
        if (!this.isConnected) throw new Error("Call connect() first!");

        return new Promise((resolve, reject) => {
            this.queue.push({
                execute: async () => {
                    return await this.ImportedProtocol.readAddress(this, registers, 0x03);
                },
                resolve,
                reject
            });

            this.processNextQueueItem();
        });
    };

    /**
     * Reads Input Registers' values from the connected PLC.
     * Input registers are read-only. 
     * @requires Must have connected using {@link connect} in order to use this.
     * @param registers - The addresses of the input registers to read from
     * @returns A record of register addresses to their values
     * @example
     * await plc.readInputs(1);
     * // { '1': { Data: Buffer, AddressValues: [54] } }
     * @example
     * await plc.readInputs([1, 6, 4]);
     * // { '1': { Data: Buffer, AddressValues: [54] }, '6': { Data: Buffer, AddressValues: [23] }, '4': { Data: Buffer, AddressValues: [11] } }
     */
    async readInputs(registers: number | string | (number | string)[], timeout: number = 2500) {
        if (!this.isConnected) throw new Error("Call connect() first!");

        return new Promise((resolve, reject) => {
            this.queue.push({
                execute: async () => {
                    return await this.ImportedProtocol.readAddress(this, registers, 0x04);
                },
                resolve,
                reject
            });

            this.processNextQueueItem();
        });
    };

    /**
     * Reads Coil values from the connected PLC.
     * Coils are digital outputs and can be read and written.
     * @requires Must have connected using {@link connect} in order to use this.
     * @param coils - The addresses of the coils to read from
     * @returns A record of coil addresses to their values
     * @example
     * await plc.readCoils(1);
     * // { '1': { Data: Buffer, AddressValues: [1] } }
     * @example
     * await plc.readCoils([1, 6, 4]);
     * // { '1': { Data: Buffer, AddressValues: [1] }, '6': { Data: Buffer, AddressValues: [0] }, '4': { Data: Buffer, AddressValues: [1] } }
     */
    async readCoils(coils: number | string | (number | string)[], timeout: number = 2500) {
        if (!this.isConnected) throw new Error("Call connect() first!");

        return new Promise((resolve, reject) => {
            this.queue.push({
                execute: async () => {
                    return await this.ImportedProtocol.readAddress(this, coils, 0x01);
                },
                resolve,
                reject
            });

            this.processNextQueueItem();
        });
    };

    /**
     * Reads Discrete Input values from the connected PLC.
     * Discrete inputs are read-only digital inputs.
     * @requires Must have connected using {@link connect} in order to use this.
     * @param discreteInputs - The addresses of the discrete inputs to read from
     * @returns A record of discrete input addresses to their values
     * @example
     * await plc.readDiscreteInputs(1);
     * // { '1': { Data: Buffer, AddressValues: [1] } }
     * @example
     * await plc.readDiscreteInputs([1, 6, 4]);
     * // { '1': { Data: Buffer, AddressValues: [1] }, '6': { Data: Buffer, AddressValues: [0] }, '4': { Data: Buffer, AddressValues: [1] } }
     */
    async readDiscreteInputs(discreteInputs: number | string | (number | string)[], timeout: number = 2500) {
        if (!this.isConnected) throw new Error("Call connect() first!");

        return new Promise((resolve, reject) => {
            this.queue.push({
                execute: async () => {
                    return await this.ImportedProtocol.readAddress(this, discreteInputs, 0x02);
                },
                resolve,
                reject
            });

            this.processNextQueueItem();
        });
    };

    /**
     * Writes a number value to a Holding Register on the connected PLC.
     * @requires Must have connected using {@link connect} in order to use this.
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
    async write(register: number | string, value: number) {
        if (!this.isConnected) throw new Error("Call connect() first!");

        return new Promise((resolve, reject) => {
            this.queue.push({
                execute: async () => {
                    return await this.ImportedProtocol.writeAddress(this, register, value, 0x06);
                },
                resolve,
                reject
            });

            this.processNextQueueItem();
        });
    };

    /**
     * Writes a boolean value to a coil on the connected PLC.
     * @requires Must have connected using {@link connect} in order to use this.
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
    async writeCoil(coil: number | string, value: boolean | number) {
        if (!this.isConnected) throw new Error("Call connect() first!");

        const BooleanToHex = value ? 0xFF00 : 0x0000;

        return new Promise((resolve, reject) => {
            this.queue.push({
                execute: async () => {
                    return await this.ImportedProtocol.writeAddress(this, coil, BooleanToHex, 0x05);
                },
                resolve,
                reject
            });

            this.processNextQueueItem();
        });
    };

    /**
     * Fires callback everytime the specified registers change values on the connected PLC.
     * @requires Must have connected using {@link connect} in order to use this.
     * @param registers - The address of the holding registers
     * @param callback - The callback/function that runs everytime value changes.
     * @param interval - How long does the script wait after every check
     * @returns A watcher that can be used to `.pause()`/`.stop()` future calls.
     * @example
     * // Log the changes.
     * const watcher = plc.watch([2,5], (changes) => {
     *  console.log(changes)
     * });
     * // Later
     * watcher.stop()
     */
    async watch(registers: number | string | (number | string)[], callback: (changes: Record<number, { PrevValue: number, Value: number }>) => void, interval: number = 1000) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");
        const addresses = Array.isArray(registers) ? registers : [registers];

        const watcher = new Watcher(this, this.ImportedProtocol, callback);
        await watcher.start(addresses, interval, 0x03);

        return watcher
    };
    
    /**
     * Fires callback everytime the specified Input Registers change values on the connected PLC.
     * @requires Must have connected using {@link connect} in order to use this.
     * @param registers - The address or addresses of the Input Registers (Read-Only 16-bit).
     * @param callback - Runs when values change. Receives an object with `PrevValue` and new `Value`.
     * @param interval - Polling delay in milliseconds between checks.
     * @returns A watcher that can be used to `.pause()`/`.stop()` future calls.
     * @example
     * // Monitor temperature sensors on registers 10 and 11
     * const sensorWatcher = await plc.watchInputs([10, 11], (changes) => {
     *   console.log('Sensor Data Changed:', changes);
     *   // changes = { "10": { PrevValue: 22, Value: 23 } }
     * });
     */
    async watchInputs(registers: number | string | (number | string)[], callback: (changes: Record<number, { PrevValue: number, Value: number }>) => void, interval: number = 1000) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");
        const addresses = Array.isArray(registers) ? registers : [registers];

        const watcher = new Watcher(this, this.ImportedProtocol, callback);
        await watcher.start(addresses, interval, 0x04);

        return watcher
    };

    /**
     * Fires callback everytime the specified Coils change state on the connected PLC.
     * @requires Must have connected using {@link connect} in order to use this.
     * @param coils - The address or addresses of the Coils (Read/Write bits).
     * @param callback - Runs when state changes. Receives an object with `PrevValue` and new `Value`.
     * @param interval - Polling delay in milliseconds between checks.
     * @returns A watcher that can be used to `.pause()`/`.stop()` future calls.
     * @example
     * // Monitor Relay or Valve states
     * const valveWatcher = await plc.watchCoils([1, 2], (changes) => {
     *   if (changes[1]?.Value === 1) console.log("Valve 1 opened");
     * });
     */
    async watchCoils(coils: number | string | (number | string)[], callback: (changes: Record<number, { PrevValue: number, Value: number }>) => void, interval: number = 1000) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");
        const addresses = Array.isArray(coils) ? coils : [coils];

        const watcher = new Watcher(this, this.ImportedProtocol, callback);
        await watcher.start(addresses, interval, 0x01);

        return watcher
    };

    /**
     * Fires callback everytime the specified Discrete Inputs change state on the connected PLC.
     * @requires Must have connected using {@link connect} in order to use this.
     * @param discreteInputs - The address or addresses of the Discrete Inputs (Read-Only bits).
     * @param callback - Runs when state changes. Receives an object with `PrevValue` and new `Value`.
     * @param interval - Polling delay in milliseconds between checks.
     * @returns A watcher that can be used to `.pause()`/`.stop()` future calls.
     * @example
     * // Monitor physical switches or proximity sensors
     * const limitWatcher = await plc.watchDiscreteInputs(500, (changes) => {
     *   console.log('Limit Switch 500 triggered:', changes[500].Value);
     * });
     */
    async watchDiscreteInputs(discreteInputs: number | string | (number | string)[], callback: (changes: Record<number, { PrevValue: number, Value: number }>) => void, interval: number = 1000) {
        if (!this.ImportedProtocol) throw new Error("Not connected yet. Call connect() first.");
        const addresses = Array.isArray(discreteInputs) ? discreteInputs : [discreteInputs];

        const watcher = new Watcher(this, this.ImportedProtocol, callback);
        await watcher.start(addresses, interval, 0x02);

        return watcher
    };
};

export default PLC