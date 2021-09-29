import {toUtf8ByteArray} from "./string";

export function hexEncode(input: string | Array<number> | Uint8Array ): string {
    let hex: Array<string> = [];

    let bytesArray;

    if(typeof input === "string") {
        try {
            bytesArray = Array.from(toUtf8ByteArray(input));
        } catch (err) {
            throw new Error("String with non UTF-8 characters");
        }
    } else if (input instanceof Array) {
        bytesArray = input;
    } else if (input instanceof Uint8Array) {
        bytesArray = Array.from(input);
    } else {
        throw new Error("Unreachable code");
    }

    for (let byte of bytesArray) {
        let val =  ('0' + (byte & 0xFF).toString(16)).slice(-2);
        hex.push(val)
    }

    return hex.join('')
}

export function hexDecode(input: string): Uint8Array {
    if (input.length % 2 !== 0) {
       throw new Error("Input string must have an even length");
    }

    const numBytes = input.length / 2;
    let byteArray = new Uint8Array(numBytes);

    for (let i = 0; i < numBytes; i++) {
        if (!isHex(input.substr(i * 2,1)) || !isHex(input.substr((i * 2) + 1, 1))){
            throw new Error("Non hexadecimal input in string");
        } else {
            byteArray[i] = parseInt(input.substr(i * 2, 2), 16);
        }
    }

    return byteArray;
}

function isHex(char: string): boolean {
    if (char.length > 1) {
        return false;
    } if (
        char === "0" || char === "1" || char === "2" || char === "3" || char === "4" || char === "5" || char === "6" ||
        char === "7" || char === "8" || char === "9" || char === "a" || char === "b" || char === "c" || char === "d" ||
        char === "e" || char === "f" || char === "A" || char === "B" || char === "C" || char === "D" || char === "E" ||
        char === "F"
    ) {
        return true;
    } else {
        return false;
    }
}