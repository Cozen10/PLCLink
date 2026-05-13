import { ImportedProtocol, PLCContext } from './Types.js';

/**
 * Monitors specific PLC addresses for any value changes.
 * Create via plc.watch()
 */
class Watcher {
    context: PLCContext;
    protocol: ImportedProtocol;
    callback: (changes: Record<number, { PrevValue: number, Value: number }>) => void;
    isMuted: boolean = false;

    functionCode!: number;
    intervalId!: ReturnType<typeof setInterval>;

    constructor (context: PLCContext, Protocol: ImportedProtocol, Callback: (changes: Record<number, { PrevValue: number, Value: number }>) => void) {
        this.context = context
        this.protocol = Protocol
        this.callback = Callback
    };

    lastData!: Record<number, { Data: Buffer, AddressValues: [number] }>;
    async start(addresses: (string | number)[], interval: number, FunctionCode: number) {
        this.functionCode = FunctionCode
        this.lastData = await this.protocol.readAddress(this.context, addresses, FunctionCode);

        this.intervalId = setInterval(async () => {
            if (this.isMuted) return;
            const newData: Record<number, { Data: Buffer, AddressValues: [number] }> = await this.protocol.readAddress(this.context, addresses, FunctionCode);

            if (this.lastData && newData) {
                let changes: Record<number, { PrevValue: number; Value: number; }> = {};
                for (const [address, value] of Object.entries(newData)) {
                    if (this.lastData[Number(address)] == undefined) continue;

                    const lastAddressValue = this.lastData[Number(address)]!.AddressValues[0]
                    const currentAddressValue = value.AddressValues[0]
    
                    if (lastAddressValue !== currentAddressValue) {
                        changes[Number(address)] = { PrevValue: lastAddressValue, Value: currentAddressValue }
                    };
                };
                
                if (Object.keys(changes).length === 0) return;

                this.callback(changes);
            };

            this.lastData = newData
        }, interval);
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
        clearInterval(this.intervalId);
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
    };

    /**
     * Resumes listening for changes.
     *@example
     // Re-enable the callback
    watcher.resume();

    console.log("Watcher is active again!");
     */
    async resume() {
        this.lastData = await this.protocol.readAddress(this.context, Object.keys(this.lastData).map(Number), this.functionCode);

        this.isMuted = false;
    };
};

export default Watcher