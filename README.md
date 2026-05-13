# PLCLink
A library that "links" node and real PLC infrastructure.
## Installation
Run the following command in the root of your directory
```bash
npm install plclink
```
## Quick Start
Save a new PLC Device with
```javascript
import PLC from 'plclink';

const plc = new PLC({ host: "[Your PLC's IP]", port: 502 })
```
**[Required]** Then connect to it using
```javascript
await plc.connect()
```
After that you can pretty much use simple commands to read/write from the PLC
## Examples
Read the value of the holding register "1" and write "54" to the holding register "2":
```javascript
import PLC from 'plclink';

const plc = new PLC({ host: "[Your PLC's IP]", port: 502 })
await plc.connect()

const ValueOf1 = await plc.read(1)
await plc.write(2, 54)

console.log(ValueOf1)
```
Set the coil "5" to false/0 and read multiple input registers:
```javascript
import PLC from 'plclink';

const plc = new PLC({ host: "[Your PLC's IP]", port: 502 })
await plc.connect()
await plc.writeCoil(5, false)

const Values = await plc.readInputs([1,23,65,98])
console.log(Values)
```
Read discrete inputs and check their values:
```javascript
import PLC from 'plclink';

const plc = new PLC({ host: "[Your PLC's IP]", port: 502 })
await plc.connect()

const inputs = await plc.readDiscreteInputs([1, 2, 3, 4])
console.log(inputs)
```

Read coil states from a machine and log which ones are active:
```javascript
import PLC from 'plclink';

const plc = new PLC({ host: "[Your PLC's IP]", port: 502 })
await plc.connect()

const coils = await plc.readCoils([1, 2, 3])
for (const [address, result] of Object.entries(coils)) {
    console.log(`Coil ${address}: ${result.AddressValues[0] ? 'ON' : 'OFF'}`)
}
```
### Using the Watcher (New in v2)
Monitor specific registers and react only when the value changes:
```javascript
import PLC from 'plclink';

const plc = new PLC({ host: "127.0.0.1" });
await plc.connect();

// Watch registers 1, 5, and 10 every 500ms
const watcher = await plc.watch([1, 5, 10], (changes) => {
    console.log("Changes detected!");
    for (const [address, data] of Object.entries(changes)) {
        console.log(`Address ${address} went from ${data.PrevValue} to ${data.Value}`);
    }
}, 500);

// You can manage the stream without destroying the interval
watcher.pause();
watcher.resume();

watcher.stop();
```

## Supported Protocols
- Modbus TCP
- S7 (Soon)
- EtherNet/IP (Soon)
- (More coming in later versions)
## API reference

### `new PLC(options)`
| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `host` | `string` | required | The IP address of the PLC |
| `port` | `number` | `502` | The port to connect to |
| `unit` | `number` | `1` | The unit ID of the PLC |
| `protocol` | `string` | `"modbus"` | The protocol to use |

### `plc.connect()`
Connects to the PLC. Must be awaited before any read/write calls.

### `plc.read(registers)`
Reads holding register values. Accepts a single address or array of addresses.

### `plc.readInputs(registers)`
Reads input register values. Read-only. Accepts a single address or array of addresses.

### `plc.readCoils(coils)`
Reads coil values. Accepts a single address or array of addresses.

### `plc.readDiscreteInputs(discreteInputs)`
Reads discrete input values. Read-only. Accepts a single address or array of addresses.

### `plc.write(register, value)`
Writes a number to a holding register.

### `plc.writeCoil(coil, value)`
Writes a boolean or `0xFF00`/`0x0000` to a coil.

### `plc.watch(registers, callback, interval)`
Fires callback every time the specified Holding Registers change value.

### `plc.watchInputs(registers, callback, interval)`
Fires callback every time the specified Input Registers change value.

### `plc.watchCoils(coils, callback, interval)`
Fires callback every time the specified Coils change state.

### `plc.watchDiscreteInputs(discreteInputs, callback, interval)`
Fires callback every time the specified Discrete Inputs change state.

### `Watcher Instance`
| Method | Description |
|--------|-------------|
| `.pause()` | Stops firing the callback but keeps polling the PLC. |
| `.resume()` | Resumes firing the callback when changes are detected. |
| `.stop()` | Clears the interval and stops the watcher completely. |

## Created and distributed by Cozen10 (Anastasios Fountoglou)