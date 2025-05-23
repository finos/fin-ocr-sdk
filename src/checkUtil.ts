/**
 * Copyright (c) 2024 Capital One
*/
import { CheckInfo } from "./check.js";
import { Context } from "./context.js";
import { Util } from "./util.js";

/*
 * X9 contains information from an X9 file related to the MICR line.
 */
export interface X9 {
    payorBankRoutingNumber: string;
    payorBankCheckDigit: string;
    onUs: string;
    auxiliaryOnUs: string;
}

export class CheckUtil {

    /*
     * Parse a MICR string and return the CheckInfo.
     */
    public static micrToCheckInfo(name: string, ctx: Context, micr?: string): CheckInfo {
        const mp = new MicrParser(micr);
        return mp.getCheckInfo(name, ctx);
    }

    /*
     * Convert info from an X9 file to CheckInfo.
     */
    public static x9ToCheckInfo(x9: X9, ctx: Context): CheckInfo {
        return this.micrToCheckInfo("X9", ctx, this.x9ToMicr(x9));
    }

    /*
     * Convert info from an X9 file to CheckInfo.
     */
    public static x9ToMicr(x9: X9): string {
        let rtn = "";
        if (x9.auxiliaryOnUs) rtn += `U${x9.auxiliaryOnUs}U`;
        rtn += `T${x9.payorBankRoutingNumber}${x9.payorBankCheckDigit}T`;
        rtn += x9.onUs.replace("/","U");
        rtn = rtn.replace(/\s/g, '');
        return rtn;
    }

}

class MicrParser {

    private readonly micrLine: string;
    private lastControlToken = "";
    private idx = 0;

    constructor(micrLine?: string) {
        micrLine = micrLine || "";
        if  (micrLine.indexOf("C") >= 0) {
            // Some translators use "ABCD" instead of "TUAD" for the MICR control characters.
            // Translate to "TUAD" if necessary where "T=Transit, U=onUs, A=Amount, and D=Dash".
            micrLine = micrLine.replace(/A/g, "T");
            micrLine = micrLine.replace(/B/g, "A");
            micrLine = micrLine.replace(/C/g, "U");
        }
        this.micrLine = micrLine;
    }

    public getCheckInfo(name: string, ctx: Context): CheckInfo {
        let routingNumber = "";
        let accountNumber = "";
        let checkNumber = "";
        let amountNumber = "";
        let tc = 0;
        let uc = 0;
        let ac = 0;
        let dc = 0;
        for (;;) {
            let token = this.nextToken();
            if (token.length == 0) break;
            if (token == 'T') tc++;
            else if (token == 'U') uc++;
            else if (token == 'A') ac++;
            else if (token == 'D') dc++;
            else {
                // token is a number
                if (this.lastControlToken == 'T') {
                    if (routingNumber.length === 0) routingNumber = token;
                    else accountNumber = token;
                } else if (ac == 1) amountNumber = token;
                else if (dc == 1) {if (ctx.isDebugEnabled()) ctx.debug(`skipping after dash: ${token}`)}
                else if (uc == 1 && tc == 0) checkNumber = token; // auxOnUs before routing number
                else if (routingNumber.length > 0) {  // after the routing number
                    if (accountNumber.length == 0) accountNumber = token;
                    else if (checkNumber.length == 0) checkNumber = token;
                }
            }
        }
        checkNumber = Util.removeLeadingZeros(checkNumber);
        const rtn = { micrLine: this.micrLine, routingNumber, accountNumber, checkNumber };
        if (ctx.isDebugEnabled()) ctx.debug(`Check info from ${name}: ${JSON.stringify(rtn)}`);
        return rtn;
    }

    private nextToken(): string {
        let token = this.nextChar();
        if (token.length == 0) return "";
        if ("TUAD".indexOf(token) >= 0) {
            this.lastControlToken = token;
            return token;
        }
        for (;;) {
            const c = this.nextChar();
            if (c >= '0' && c <= '9') {
                token += c;
            } else {
                if (c.length > 0) this.pushback();
                return token;
            }
        }
    }

    private nextChar(): string {
        for (;;) {
            if (this.idx >= this.micrLine.length) return "";
            const c = this.micrLine.charAt(this.idx++);
            if ("TUAD0123456789".indexOf(c) >= 0) return c;
        }
    }

    private pushback() {
        this.idx--;
    }

}
