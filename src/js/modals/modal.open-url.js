import TangramPlay from '../tangram-play';
import Modal from './modal';
import EditorIO from '../editor/io';

let modalEl;

class OpenUrlModal extends Modal {
    constructor () {
        super();

        this.el = modalEl = document.body.querySelector('.open-url-modal');
        this.message = 'Open a scene file from URL';
        this.input = this.el.querySelector('.open-url-input input');
        this.input.addEventListener('keyup', (event) => {
            if (this.input.value && this.input.validity.valid === true && this.input.value.match(/\.y(a?)ml$/)) {
                this.el.querySelector('.modal-confirm').removeAttribute('disabled');
                let key = event.keyCode || event.which;
                if (key === 13) {
                    this._handleConfirm();
                }
            }
            else {
                this.el.querySelector('.modal-confirm').disabled = true;
            }
        });

        this.onConfirm = () => {
            const value = this.input.value;
            this.clearInput();
            TangramPlay.load({ url: value });
        };

        this.onAbort = () => {
            this.clearInput();
        };
    }

    show () {
        EditorIO.checkSaveStateThen(() => {
            super.show();
            this.input.focus();
        });
    }

    clearInput () {
        this.input.value = '';
        this.input.blur();
        this.el.querySelector('.modal-confirm').disabled = true;
    }
}

export const openURLModal = new OpenUrlModal();
