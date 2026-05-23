import { EventEmitter } from 'events';
import { ImportedProtocol, PLCContext } from './Types.js';

const hardcodedParser = {
    0x01:"coil",
    0x02:"discrete",
    0x03:"holding",
    0x04:"input"
}

/**
 * Monitors specific PLC addresses for any value changes.
 * Create via plc.watch()
 */
class Watcher extends EventEmitter {
    context: PLCContext;
    protocol: ImportedProtocol;
    callback: (changes: Record<number, { PrevValue: number, Value: number }>) => void;
    isMuted: boolean = false;
    isStopped: boolean = false;

    functionCode!: number;
    intervalId!: ReturnType<typeof setInterval>;

    constructor (context: PLCContext, Protocol: ImportedProtocol, Callback: (changes: Record<number, { PrevValue: number, Value: number }>) => void) {
        super()
        this.context = context
        this.protocol = Protocol
        this.callback = Callback
    };

    lastData!: Record<number, { Data: Buffer, AddressValues: [number] }>;
    private recursiveLoop = async (addresses: (string | number)[], interval: number) => {
        if (interval <= 0) { interval=1000 };
        try {
            const newData: Record<number, { Data: Buffer, AddressValues: [number] }> = await this.protocol.readAddress(this.context, addresses, this.functionCode);
            
            if (this.lastData && newData) {
                let changes: Record<number, { PrevValue: number; Value: number; }> = {};
                let hasChanged: boolean = false;
                for (const [address, value] of Object.entries(newData)) {
                    if (this.lastData[Number(address)] == undefined) continue;
    
                    const lastAddressValue = this.lastData[Number(address)]!.AddressValues[0]
                    const currentAddressValue = value.AddressValues[0]
                    const typeLabel = hardcodedParser[this.functionCode as keyof typeof hardcodedParser] || "data";

                    if (lastAddressValue !== currentAddressValue) {
                        changes[Number(address)] = { PrevValue: lastAddressValue, Value: currentAddressValue }
                        this.context.emit(`change:${this.context.Protocol}:${typeLabel}:${address}`, currentAddressValue, lastAddressValue);
                        this.emit('change', { address: address, value: currentAddressValue, lastAddressValue });
                        hasChanged = true
                    };
                };
    
                this.lastData = newData
                
                if (!hasChanged) return;
                if (this.isMuted) return;
    
                this.callback(changes);
            };
        } catch (error) {
            this.isStopped = true
            if (this.listenerCount('error') > 0) {
                this.emit("error", error);
            }
            this.emit("stop")
            console.error("Watcher encountered an error:", error);
        } finally {
            if (!this.isStopped) {
                this.intervalId = setTimeout(() => this.recursiveLoop(addresses, interval), interval);
            }
        };
    };

    async start(addresses: (string | number)[], interval: number, FunctionCode: number) {
        if (interval <= 0) { throw new Error("INT_OUT_OF_RANGE") }
        this.lastData = await this.protocol.readAddress(this.context, addresses, FunctionCode);
        this.functionCode = FunctionCode

        this.intervalId = setTimeout(() => this.recursiveLoop(addresses, interval), interval);
    };

    /**
     * Completely stops and destroys the Watcher
     * @example
     * watcher.stop()
     * @example
     * // 1. Start watching a register
    const watcher = await plc.watch(100, (changes) => {
        console.log("Value changed:", changes);
    });

    // 2. Stop the watcher after 10 seconds
    setTimeout(() => {
        console.log("Ending monitoring session...");
        watcher.stop();
    }, 10000);
     */
    stop() {
        this.isStopped = true;
        clearTimeout(this.intervalId);
        this.emit("stop")
    };

    /**
     * Temporarily ignores changes without stopping the interval.
     * @example
     * // Start watching register 1
    const watcher = await plc.watch(1, (changes) => {
        console.log("This won't log while paused:", changes);
    });

    // Ignore all changes from now on
    watcher.pause();
    */
    pause() {
        this.isMuted = true;
        this.emit("pause")
    };

    /**
     * Resumes listening for changes.
     *@example
     // Re-enable the callback
    watcher.resume();

    console.log("Watcher is active again!");
     */
    async resume() {
        try {
            this.lastData = await this.protocol.readAddress(this.context, Object.keys(this.lastData).map(Number), this.functionCode);
        } catch (error) {
            this.emit("error", error);
            console.error(error)
            return;
        }

        this.isMuted = false;
        this.emit("resume");
    };
};

export default Watcher