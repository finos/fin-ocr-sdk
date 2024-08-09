/**
 * Copyright (c) 2024 Discover Financial Services
*/
export class Log {

    private static levels = ["fatal", "error", "warn", "info", "debug", "trace", "verbose"];
    private static levelsLog = ["fat", "err", "wrn", "inf", "dbg", "trc", "vrb"];
    public static level = 3;

    /**
     * Create a new log.
     * @param name
     * @returns A new log
     */
    public static new(name: string, levelName?: string): Log {
        return new Log(name, levelName);
    }

    /**
     * Return all log level names.
     * @returns The log level names
     */
    public static getLevelNames(): string[] {
        return this.levels;
    }

    public static setLogLevel(levelName: string) {
        const level = this.logLevelNameToNumber(levelName);
        if (level == undefined) throw new Error(`'${levelName}' is an invalid log level name; expecting one of ${JSON.stringify(this.levels)}`);
        this.level = level;
        return true;
    }

    public static logLevelNameToNumber(name?: string): number | undefined {
        if (!name) return Log.level;
        const level = this.levels.indexOf(name);
        if (level < 0) return undefined;
        return level;
    }

    public id: string;
    public level: number;
    public bufferLevel?: number;
    public readonly buffer: string[] = [];
    public cs = console;

    constructor(id: string, levelName?: string) {
        this.id = id;
        const levelNumber = Log.logLevelNameToNumber(levelName);
        this.level = levelNumber !== undefined ? levelNumber : Log.level;
    }

    public setLogLevel(levelName: string): boolean {
        const levelNumber = Log.logLevelNameToNumber(levelName);
        if (levelNumber == undefined) return false;
        this.level = levelNumber;
        return true;
    }

    public setBufferLogLevel(levelName?: string): boolean {
        if (!levelName) {
            this.bufferLevel = undefined;
            return true;
        }
        const levelNumber = Log.logLevelNameToNumber(levelName);
        if (levelNumber == undefined) return false;
        this.bufferLevel = levelNumber;
        return true;
    }

    public setConsole(cs: any) {
        this.cs = cs;
    }

    public isEnabled(level: number): boolean {
        return this.isNormalEnabled(level) || this.isBufferEnabled(level);
    }

    private isNormalEnabled(level: number): boolean {
        return level <= this.level;
    }

    private isBufferEnabled(level: number): boolean {
        return this.bufferLevel !== undefined && level <= this.bufferLevel;
    }

    public isFatalEnabled(): boolean {
        return this.isEnabled(0);
    }

    public isErrorEnabled(): boolean {
        return this.isEnabled(1);
    }

    public isWarnEnabled(): boolean {
        return this.isEnabled(2);
    }

    public isInfoEnabled(): boolean {
        return this.isEnabled(3);
    }

    public isDebugEnabled(): boolean {
        return this.isEnabled(4);
    }

    public isTraceEnabled(): boolean {
        return this.isEnabled(5);
    }

    public isVerboseEnabled(): boolean {
        return this.isEnabled(6);
    }

    public fatal(s: string, ...elements: any[]) { this.log(0, s, ...elements) }
    public error(s: string, ...elements: any[]) { this.log(1, s, ...elements) }
    public warn(s: string, ...elements: any[]) { this.log(2, s, ...elements) }
    public info(s: string, ...elements: any[]) { this.log(3, s, ...elements) }
    public debug(s: string, ...elements: any[]) { this.log(4, s, ...elements) }
    public trace(s: string, ...elements: any[]) { this.log(5, s, ...elements) }
    public verbose(s: string, ...elements: any[]) { this.log(6, s, ...elements) }

    public log(level: number, s: string, ...elements: any[]) {
        if (!this.isEnabled(level)) return;
        const msg = `${new Date().toISOString()} ${Log.levelsLog[level]} ${this.id} ${s}`;
        if (this.isNormalEnabled(level)) {
            if (elements.length === 0) {
                this.cs.log(msg);
            } else {
                this.cs.log(msg, elements);
            }
        }
        if (this.isBufferEnabled(level)) {
            this.buffer.push(msg);
        }
    }

    public flushBuffer(msg: string) {
        const sep = "\n    ";
        this.warn(`${msg}:${sep}${this.buffer.join(sep)}`);
        this.buffer.length = 0;
    }

}
