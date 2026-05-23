import net from 'net';

export interface PLCContext {
    Socket: net.Socket;
    PendingReads: Map<number, Function>;
    PendingWrites: Map<number, Function>;
    SavedBuffer: Buffer;
    Unit: number;
    intenionalDisconnect: Boolean;
    emit: Function;
    Protocol: string;
};

export interface ImportedProtocol { readAddress: Function, writeAddress: Function, onData: Function, disconnect: Function };