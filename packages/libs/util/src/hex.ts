import {toUtf8ByteArray} from "./string";

export async function hexEncode(input: string | Array<number> | Uint8Array ): Promise<string> {
    let hex: Array<string> = [];

    let bytesArray;

    if(typeof input === "string") {
        try {
            bytesArray = Array.from(await toUtf8ByteArray(input));
        } catch (err) {
           return Promise.reject("String with non UTF-8 characters");
        }
    } else if (input instanceof Array) {
        bytesArray = input;
    } else if (input instanceof Uint8Array) {
        bytesArray = Array.from(input);
    } else {
        return Promise.reject("Unreachable code");
    }

    for (let byte of bytesArray) {
        try {
            let val =  ('0' + (byte & 0xFF).toString(16)).slice(-2);
            hex.push(val)
        } catch (err) {
            return Promise.reject(err);
        }
    }

    return hex.join('')
}

export async function hexDecode(input: string): Promise<Uint8Array> {
    if (input.length % 2 !== 0) {
        return Promise.reject("Input string must have an even length");
    }

    const numBytes = input.length / 2;
    let byteArray = new Uint8Array(numBytes);

    for (let i = 0; i < numBytes; i++) {
        try {
            if (!isHex(input.substr(i * 2,1)) || !isHex(input.substr((i * 2) + 1, 1))){
                return Promise.reject("Non hexadecimal input in string");
            } else {
                byteArray[i] = parseInt(input.substr(i * 2, 2), 16);
            }
        } catch (err) {
            return Promise.reject(err)
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