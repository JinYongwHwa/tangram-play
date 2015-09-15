'use strict';

import TangramPlay from 'app/TangramPlay';
import { noop } from 'app/addons/ui/Helpers';
import EditorIO from 'app/addons/ui/EditorIO';
import FileOpen from 'app/addons/ui/FileOpen';
import ExamplesModal from 'app/addons/ui/Modal.Examples';
import Tooltip from 'app/addons/ui/Tooltip';
import MapToolbar from 'app/addons/ui/MapToolbar';

export default class Menu {
    constructor () {
        this.el = TangramPlay.container.querySelector('.tp-menu-bar');
        this.menus = {};
        this.initMenuItems();
    }

    initMenuItems () {
        this.menus.open = new MenuItem('.tp-menu-button-open', _onClickOpen);
        this.menus.new = new MenuItem('.tp-menu-button-new', _onClickNew);
        this.menus.export = new MenuItem('.tp-menu-button-export', _onClickExport);
        this.menus.map = new MenuItem('.tp-menu-button-map', _onClickMap);
        this.menus.help = new MenuItem('.tp-menu-button-help');

        this.fileopen = new FileOpen();
        this.examplesModal = new ExamplesModal(TangramPlay.options.menu);

        Tooltip.init();

        TangramPlay.container.querySelector('.tp-menu-open-file').addEventListener('click', () => {
            this.fileopen.activate();
        }, false);
        TangramPlay.container.querySelector('.tp-menu-open-example').addEventListener('click', () => {
            this.examplesModal.show();
        }, false);
    }
}

export class MenuItem {
    constructor (classSelector, onClick = noop) {
        this.el = TangramPlay.container.querySelector(classSelector);

        // Attach listeners, including those for tooltip behavior
        this.el.addEventListener('click', (event) => {
            this.el.setAttribute('data-tooltip-state', 'disabled');
            onClick(event);
        }, true);
        this.el.addEventListener('mouseenter', (e) => {
            Tooltip.considerShowing(this.el);
        }, false);
        this.el.addEventListener('mouseleave', (e) => {
            Tooltip.hide();
        }, false);
    }
}

function _onClickOpen (event) {
    let menuEl = TangramPlay.container.querySelector('.tp-menu-dropdown-open');
    let posX = TangramPlay.container.querySelector('.tp-menu-button-open').getBoundingClientRect().left;
    menuEl.style.left = posX + 'px';
    menuEl.style.display = (menuEl.style.display === 'block') ? 'none' : 'block';
    if (menuEl.style.display === 'none') {
        _resetTooltipState();
    }
    TangramPlay.container.addEventListener('click', _onClickOutsideDropdown, false);
}

function _onClickNew (event) {
    EditorIO.new();
    _resetTooltipState();
}

function _onClickExport (event) {
    EditorIO.export();
    _resetTooltipState();
}

function _onClickMap (event) {
    MapToolbar.toggle();
}

function _onClickOutsideDropdown (event) {
    let target = event.target;

    while (target !== document.documentElement && !target.classList.contains('tp-menu-item')) {
        target = target.parentNode;
    }

    if (!target.classList.contains('tp-menu-item')) {
        _loseMenuFocus();
        TangramPlay.container.removeEventListener('click', _onClickOutsideDropdown, false);
    }
}

function _loseMenuFocus () {
    _hideMenus();
    _resetTooltipState();
}

function _hideMenus () {
    let menus = document.querySelectorAll('.tp-menu-dropdown');
    for (let el of menus) {
        el.style.display = 'none';
    }
    TangramPlay.container.removeEventListener('click', _onClickOutsideDropdown, false);
}

function _resetTooltipState () {
    let items = document.querySelectorAll('.tp-menu-item');
    for (let el of items) {
        el.removeAttribute('data-tooltip-state');
    }
}
