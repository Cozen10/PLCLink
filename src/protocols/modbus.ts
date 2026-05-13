import { PLCContext } from '../Types.js';

export async function writeAddress(ctx: PLCContext, address: number | string, value: number, functionCode: number) {    
    const numericAddress: number = Number(address)
    if (numericAddress === undefined || isNaN(numericAddress)) return;

    return await new Promise((resolve) => {
        const TransactionId = Math.floor(Math.random() * 65535);
        
        let buffer = Buffer.alloc(12);
        buffer.writeUInt16BE(TransactionId, 0);
        buffer.writeUInt16BE(0x0000, 2);
        buffer.writeUInt16BE(0x0006, 4);
        buffer.writeUInt8(ctx.Unit, 6);
    
        buffer.writeUint8(functionCode, 7);
        
        buffer.writeUint16BE(numericAddress, 8);
        buffer.writeUint16BE(value, 10);
    
        ctx.PendingWrites.set(TransactionId, resolve);

        ctx.Socket.write(buffer);
    });
};

export async function readAddress(ctx: PLCContext, addresses: number | string | (number | string)[], functionCode: number) {
    const numericAddresses: number[] = (Array.isArray(addresses) ? addresses : [addresses]).map(a => Number(a));
    let CollectiveData: Record<number, Promise<any>> = {};

    for (const register of numericAddresses) {
        CollectiveData[register] = new Promise((resolve) => {
            const TransactionId = Math.floor(Math.random() * 65535);
        
            let buffer = Buffer.alloc(12);
            buffer.writeUInt16BE(TransactionId, 0);
            buffer.writeUInt16BE(0x0000, 2);
            buffer.writeUInt16BE(0x0006, 4);
            buffer.writeUInt8(ctx.Unit, 6);
        
            buffer.writeUint8(functionCode, 7);
            
            buffer.writeUint16BE(register, 8);
            buffer.writeUInt16BE(0x0001, 10);
        
            ctx.PendingReads.set(TransactionId, resolve)
    
            ctx.Socket.write(buffer);
        });
    };
    
    let Values: Promise<any>[] = [];

    for (const Entry of Object.entries(CollectiveData)) {
        Values.push(Entry[1]);
    };

    const CleanValues = await Promise.all(Values);
    let CleanData: Record<number, any> = {};

    let Count = 0
    for (const address of numericAddresses) {
        CleanData[address] = CleanValues[Count]
        Count++;
    };

    return CleanData;
};

export function onData(ctx: PLCContext, data: Buffer) {
    ctx.SavedBuffer = Buffer.concat([ctx.SavedBuffer, data]);
    
    while (ctx.SavedBuffer.length >= 6) {
        const TransactionId = ctx.SavedBuffer.readUint16BE(0);
        const FunctionCode = ctx.SavedBuffer.readUInt8(7);
        const Length = ctx.SavedBuffer.readUint16BE(4);
        const ReadResolve = ctx.PendingReads.get(TransactionId);
        const WriteResolve = ctx.PendingWrites.get(TransactionId);
        
        if (ctx.SavedBuffer.length < 6 + Length) break;
        
        let AddressValues: number[] = [];
        
        if (ReadResolve) {
            const NumberOfBytes = ctx.SavedBuffer.readInt8(8);
            let Count = 0;
            for (let CurrentOffset = 9; CurrentOffset < 9 + NumberOfBytes;) {
                let Value: number;
                if (FunctionCode == 0x03 || FunctionCode == 0x04) {
                    Value = ctx.SavedBuffer.readUInt16BE(CurrentOffset);
                    CurrentOffset+=2;
                    AddressValues[Count++] = Value;
                } else if (FunctionCode == 0x01 || FunctionCode == 0x02) {
                    Value = ctx.SavedBuffer.readUInt8(CurrentOffset);
                    CurrentOffset++;
                    AddressValues[Count++] = Value;
                };
            };
            ReadResolve({ Data: ctx.SavedBuffer, AddressValues: AddressValues });
            ctx.PendingReads.delete(TransactionId);
        } else if (WriteResolve) {
            WriteResolve({ 
                Status: "success", 
                Content: {
                    Address: ctx.SavedBuffer.readUInt16BE(8), 
                    Value: ctx.SavedBuffer.readUInt16BE(10) 
                } 
            });
            ctx.PendingWrites.delete(TransactionId);
        };
        
        ctx.SavedBuffer = ctx.SavedBuffer.subarray(6 + Length);
    };
};