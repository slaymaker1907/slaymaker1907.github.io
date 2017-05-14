class LazyProperty {
    constructor(init, cb) {
        this._value = init;
        this.cb = cb;
    }

    get value() {
        return this._value;
    }

    set value(val) {
        if (this._value !== val) {
            this._value = val;
            this.cb(val);
        }
    }
}

class Instrument {
    constructor(synth) {
        this.synth = synth;
        this.isPlaying = new LazyProperty(false, playing => {
            if (playing) {
                this.synth.triggerAttack(this.note.value);
            } else {
                this.synth.triggerRelease();
            }
        });
        this.note = new LazyProperty("C4", note => {
            if (this.isPlaying.value) {
                this.synth.triggerRelease();
                console.log(note);
                setTimeout(() =>this.synth.triggerAttack(note), 0);
            }
        });
        this.volume = new LazyProperty(this.synth.volume.value, volume => {
            this.synth.volume.value = volume;
        });
    }
}

const SYNTH = new Instrument(new Tone.Synth().toMaster());

const SPACE = " ".charCodeAt(0);
const ACHAR = "A".charCodeAt(0);
const GCHAR = "G".charCodeAt(0);
const KEY_MAP = {
    Q: 'C3',
    W: 'D3',
    E: 'E3',
    R: 'F3',
    T: 'G3',
    A: 'A3',
    S: 'B3',
    D: 'C4',
    F: 'D4',
    G: 'E4'
};
window.onload = () => {
    document.body.onkeydown = eve => {
        if (eve.keyCode === SPACE) {
            SYNTH.isPlaying.value = true;
        }
    };

    document.body.onkeyup = eve => {
        const note = String.fromCodePoint(eve.keyCode);
        if (eve.keyCode === SPACE) {
            SYNTH.isPlaying.value = false;
        } else if (KEY_MAP.hasOwnProperty(note)) {
            SYNTH.note.value = KEY_MAP[note];
        }
    }
    const volumeEle = document.getElementById("volume");
    volumeEle.oninput = () => {
        SYNTH.volume.value= (parseInt(volumeEle.value) - 50) / 1.75;
    }
}
