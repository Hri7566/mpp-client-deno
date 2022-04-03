import { EventEmitter } from "https://deno.land/std@0.84.0/node/events.ts";
import { Participant } from "./Participant.d.ts";
import { Channel } from "./Channel.d.ts";

export default class Client extends EventEmitter {
    uri: string;
    ws: WebSocket | any;
    serverTimeOffset: number;
    user: Participant | undefined;
    participantId: string;
    channel: Channel | undefined;
    ppl: Record<string, Participant>;
    connectionTime: number | undefined;
    connectionAttempts: number;
    desiredChannelId: string | undefined;
    desiredChannelSettings: Record<string, unknown>;
    pingInterval: number | undefined;
    canConnect: boolean | undefined;
    noteBuffer: Record<string, unknown>[];
    noteBufferTime: number;
    noteFlushInterval: number | undefined;
    ['🐈']: number;
    offlineParticipant: Participant;
    offlineChannelSettings: Record<string, string | boolean>;
    token: string | undefined;

    constructor (uri: string, token?: string) {
        super();
        this.uri = uri;
        this.ws = undefined;
        this.serverTimeOffset = 0;
        this.user = undefined;
        this.participantId = "";
        this.channel = undefined;
        this.ppl = {};
        this.connectionTime = undefined;
        this.connectionAttempts = 0;
        this.desiredChannelId = undefined;
        this.desiredChannelSettings = {};
        this.pingInterval = undefined;
        this.canConnect = false;
        this.noteBuffer = [];
        this.noteBufferTime = 0;
        this.noteFlushInterval = undefined;
        this['🐈'] = 0;
        this.offlineParticipant = {
            _id: "",
            name: "",
            color: "#777",
            id: ""
        };
        this.offlineChannelSettings = {
            color:"#ecfaed"
        };
        this.token = token;
        this.bindEventListeners();
        this.emit("status", "(Offline mode)");
    }
    
    bindEventListeners() {
        var self = this;
        this.on("hi", function(msg) {
            self.user = msg.u;
            self.receiveServerTime(msg.t, msg.e || undefined);
            if(self.desiredChannelId) {
                self.setChannel();
            }
        });
        this.on("t", function(msg) {
            self.receiveServerTime(msg.t, msg.e || undefined);
        });
        this.on("ch", function(msg) {
            self.desiredChannelId = msg.ch._id;
            self.desiredChannelSettings = msg.ch.settings;
            self.channel = msg.ch;
            if(msg.p) self.participantId = msg.p;
            self.setParticipants(msg.ppl);
        });
        this.on("p", function(msg) {
            self.participantUpdate(msg);
            self.emit("participant update", self.findParticipantById(msg.id));
        });
        this.on("m", function(msg) {
            if(self.ppl.hasOwnProperty(msg.id)) {
                self.participantUpdate(msg);
            }
        });
        this.on("bye", function(msg) {
            self.removeParticipant(msg.p);
        });
    }

    receiveServerTime(time: any, echo: any) {
        // let self = this;
        const now = Date.now();
        const target = time - now;
        //console.log("Target serverTimeOffset: " + target);
        const duration = 1000;
        let step = 0;
        const steps = 50;
        const step_ms = duration / steps;
        const difference = target - this.serverTimeOffset;
        const inc = difference / steps;
        const iv: number = setInterval(() => {
            this.serverTimeOffset += inc;
            if(++step >= steps) {
                clearInterval(iv);
                //console.log("serverTimeOffset reached: " + self.serverTimeOffset);
                this.serverTimeOffset=target;
            }
        }, step_ms);
        // smoothen

        //this.serverTimeOffset = time - now;			// mostly time zone offset ... also the lags so todo smoothen this
                                    // not smooth:
        //if(echo) this.serverTimeOffset += echo - now;	// mostly round trip time offset
    }

    setChannel(id?: string, set?: any) {
        this.desiredChannelId = id || this.desiredChannelId || "lobby";
        this.desiredChannelSettings = set || this.desiredChannelSettings || undefined;
        this.sendArray([{m: "ch", _id: this.desiredChannelId, set: this.desiredChannelSettings}]);
    }

    sendArray(arr: any) {
        this.send(JSON.stringify(arr));
    }

    send(raw: string) {
        if(this.isConnected()) this.ws.send(raw);
    }

    isConnected() {
        return this.isSupported() && this.ws && this.ws.readyState === 1;
    }

    isConnecting() {
        return this.isSupported() && this.ws && this.ws.readyState === 0;
    }

    isSupported() {
        return typeof WebSocket === "function";
    }

    start() {
        this.canConnect = true;
        this.connect();
    }

    stop() {
        this.canConnect = false;
        this.ws.close();    
    }

    connect() {
        if(!this.canConnect || !this.isSupported() || this.isConnected() || this.isConnecting()) return;
        this.emit("status", "Connecting...");
        this.ws = new WebSocket(this.uri);
        this.ws.addEventListener("close", (evt: any) => {
            this.user = undefined;
            this.participantId = "";
            this.channel = undefined;
            this.setParticipants([]);
            clearInterval(this.pingInterval);
            clearInterval(this.noteFlushInterval);

            this.emit("disconnect", evt);
            this.emit("status", "Offline mode");

            // reconnect!
            if(this.connectionTime) {
                this.connectionTime = undefined;
                this.connectionAttempts = 0;
            } else {
                ++this.connectionAttempts;
            }
            const ms_lut = [50, 2950, 7000, 10000];
            let idx = this.connectionAttempts;
            if(idx >= ms_lut.length) idx = ms_lut.length - 1;
            const ms = ms_lut[idx];
            setTimeout(this.connect.bind(this), ms);
        });
        this.ws.addEventListener("error", (err: Error) => {
            this.emit("wserror", err);
            this.ws.webSocket.close(); // self.ws.emit("close");
        });
        this.ws.addEventListener("open", () => {
            this.connectionTime = Date.now();
            
            this.sendArray([{
                "m": "hi",
                "🐈": this['🐈']++ || undefined,
                token: this.token
            }]);

            this.pingInterval = setInterval(() => {
                this.sendArray([{m: "t", e: Date.now()}]);
            }, 20000);
            //self.sendArray([{m: "t", e: Date.now()}]);
            
            this.noteBuffer = [];
            this.noteBufferTime = 0;
            
            this.noteFlushInterval = setInterval(() => {
                if(this.noteBufferTime && this.noteBuffer.length > 0) {
                    this.sendArray([{m: "n", t: this.noteBufferTime + this.serverTimeOffset, n: this.noteBuffer}]);
                    this.noteBufferTime = 0;
                    this.noteBuffer = [];
                }
            }, 200);

            this.emit("connect");
            this.emit("status", "Joining channel...");
        });
        this.ws.addEventListener("message", (evt: Record<string, any>) => {
            const transmission = JSON.parse(evt.data);
            for(let i = 0; i < transmission.length; i++) {
                const msg = transmission[i];
                this.emit(msg.m, msg);
            }
        });
    }

    setParticipants(ppl: any) {
        for (const id in this.ppl) {
            if(!this.ppl.hasOwnProperty(id)) continue;
            let found = false;
            for(let j = 0; j < ppl.length; j++) {
                if(ppl[j].id === id) {
                    found = true;
                    break;
                }
            }
            if(!found) {
                this.removeParticipant(id);
            }
        }
        // update all
        for(var i = 0; i < ppl.length; i++) {
            this.participantUpdate(ppl[i]);
        }
    }

    participantUpdate(update: Participant) {
        let part = this.ppl[update.id] || null;
        if(part === null) {
            part = update;
            this.ppl[part.id] = part;
            this.emit("participant added", part);
            this.emit("count", this.countParticipants());
        } else {
            if(update.x) part.x = update.x;
            if(update.y) part.y = update.y;
            if(update.color) part.color = update.color;
            if(update.name) part.name = update.name;
        }
    }

    findParticipantById(id: string) {
        return this.ppl[id] || this.offlineParticipant;
    }

    removeParticipant(id: string) {
        if(this.ppl.hasOwnProperty(id)) {
            var part = this.ppl[id];
            delete this.ppl[id];
            this.emit("participant removed", part);
            this.emit("count", this.countParticipants());
        }
    }

    countParticipants() {
        var count = 0;
        for(var i in this.ppl) {
            if(this.ppl.hasOwnProperty(i)) ++count;
        }
        return count;
    }

    getChannelSetting(key: string) {
        if(!this.isConnected() || !this.channel || !this.channel.settings) {
            return this.offlineChannelSettings[key];
        } 
        return this.channel.settings[key];
    }

    setChannelSettings(settings: Record<string, string | boolean>) {
        if(!this.isConnected() || !this.channel || !this.channel.settings) {
            return;
        } 
        if(this.desiredChannelSettings){
            for(var key in settings) {
                this.desiredChannelSettings[key] = settings[key];
            }
            this.sendArray([{m: "chset", set: this.desiredChannelSettings}]);
        }    
    }

    getOwnParticipant() {
        return this.findParticipantById(this.participantId);
    }

    isOwner() {
        return this.channel && this.channel.crown && this.channel.crown.participantId === this.participantId;
    }

    preventsPlaying() {
        return this.isConnected() && !this.isOwner() && this.getChannelSetting("crownsolo") === true;
    }

    startNote(note: any, v: number) {
        if(this.isConnected()) {
            const vel: number | undefined = typeof v === "undefined" ? undefined : +v.toFixed(3);
            if(!this.noteBufferTime) {
                this.noteBufferTime = Date.now();
                this.noteBuffer.push({n: note, v: vel});
            } else {
                this.noteBuffer.push({d: Date.now() - this.noteBufferTime, n: note, v: vel});
            }
        }
    }

    stopNote(note: any) {
        if(this.isConnected()) {
            if(!this.noteBufferTime) {
                this.noteBufferTime = Date.now();
                this.noteBuffer.push({n: note, s: 1});
            } else {
                this.noteBuffer.push({d: Date.now() - this.noteBufferTime, n: note, s: 1});
            }
        }
    }
}

export {
    Client
};
