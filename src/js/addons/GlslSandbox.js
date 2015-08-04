import TangramPlay from '../TangramPlay.js';

import { fetchHTTP, debounce, getPosition, toCSS } from '../core/common.js';
import { isEmpty } from '../core/codemirror/tools.js';
import { isNormalBlock, isColorBlock, getAddressSceneContent, getKeysFromAddress, getAddressFromKeys } from '../core/codemirror/yaml-tangram.js';

(function() {
    var lastTime = 0;
    var vendors = ['ms', 'moz', 'webkit', 'o'];
    for(var x = 0; x < vendors.length && !window.requestAnimationFrame; ++x) {
        window.requestAnimationFrame = window[vendors[x] + 'RequestAnimationFrame'];
        window.cancelAnimationFrame = window[vendors[x] + 'CancelAnimationFrame']
                                   || window[vendors[x] + 'CancelRequestAnimationFrame'];
    }
    if (!window.requestAnimationFrame) {
        window.requestAnimationFrame = function(callback, element) {
            var currTime = new Date().getTime();
            var timeToCall = Math.max(0, 16 - (currTime - lastTime));
            var id = window.setTimeout(function() {
                callback(currTime + timeToCall);
            }, timeToCall);
            lastTime = currTime + timeToCall;
            return id;
        };
    }
    if (!window.cancelAnimationFrame) {
        window.cancelAnimationFrame = function(id) {
            clearTimeout(id);
        };
    }
}());

// Debounced event after user stop doing something
var stopAction = debounce(function(cm) {
    cm.glslSandbox.change = true;
    if (cm.glslSandbox.active) {
        cm.glslSandbox.reload();
    }
}, 1000);

export default class GlslSandbox {
    constructor (tangramPlay, configFile) {
        //  Make link to this manager inside codemirror obj to be excecuted from CM events
        tangramPlay.editor.glslSandbox = this;

        // Constant OBJ
        // this.tangramPlay = tangramPlay;
        this.shader = undefined;
        this.element = document.createElement('div');
        this.element.id = 'tp-a-sandbox';
        this.element.setAttribute('width', '130');
        this.element.setAttribute('height', '130');

        this.canvas = document.createElement('canvas');
        this.canvas.id = 'tp-a-sandbox-canvas';
        this.canvas.className = 'glslSandbox';
        this.canvas.setAttribute('width', '130');
        this.canvas.setAttribute('height', '130');
        this.canvas.setAttribute('data-fragment', `
    precision mediump float;
    varying vec2 v_texcoord;
    void main() {
        gl_FragColor = vec4(v_texcoord.x, v_texcoord.y, 1.0, 1.0);
    }`);
        this.element.appendChild(this.canvas);

        this.colorPicker = document.createElement('div');
        this.colorPicker.addEventListener('click', this.onColorClick.bind(this));
        this.colorPicker.id = 'tp-a-sandbox-colorpicker';
        this.element.appendChild(this.colorPicker);

        // VARIABLES
        this.active = false;
        this.line = -1;
        this.address = '';
        this.animated = false;
        this.change = true;
        this.uniforms = {};

        // Tangram uniforms
        this.setColor([0, 1, 0, 1]);
        this.uniforms['u_device_pixel_ratio'] = window.devicePixelRatio;
        this.uniforms['u_meters_per_pixel'] = 1;
        this.uniforms['u_map_position'] = [0, 0, 0];
        this.uniforms['u_tile_origin'] = [0, 0, 0];
        this.uniforms['u_vanishing_point'] = 1;

        // EVENTS
        tangramPlay.editor.on('cursorActivity', function(cm) {
            cm.glslSandbox.onCursorMove();
        });

        tangramPlay.editor.on('changes', function(cm, changesObj) {
            stopAction(cm);
        });
    }

    reload(nLine) {
        if (nLine === undefined) {
            nLine = this.tangramPlay.editor.getCursor().line;
        }

        if (!isEmpty(this.tangramPlay.editor, nLine)) {
            let keys = this.tangramPlay.getKeysOnLine(nLine);
            if (keys && keys[0]) {
                this.address = keys[0].address;
                let isNormal = isNormalBlock(this.address);
                let isColor = isColorBlock(this.address);

                if (isNormal || isColor) {
                    // Store address and states
                    this.styleObj = getStyleObj(this.tangramPlay.scene, this.address);

                    if (this.styleObj === undefined || this.styleObj === null ||
                        this.styleObj.shaders === undefined || this.styleObj.shaders === null) {
                        this.disable();
                        return;
                    }

                    //  Start sandbox and inject widget
                    if (this.shader === undefined) {
                        this.shader = new GlslCanvas(this.canvas);
                    }
                    this.tangramPlay.editor.addWidget({ line: nLine, ch: 0 }, this.element);

                    if (this.styleObj.shaders.uniforms) {
                        for (let name in this.styleObj.shaders.uniforms) {
                            this.uniforms[name] = this.styleObj.shaders.uniforms[name];
                        }
                    }

                    // Load block data
                    // if (this.styleObj.material) {   // Materials
                    //     for (let el in this.styleObj.material) {
                    //         if (!Array.isArray(this.styleObj.material[el]) && this.styleObj.material[el].texture ){
                    //             this.uniforms['u_material_'+el+'_texture'] = this.styleObj.material[el].texture;
                    //             this.uniforms['u_material.'+el+'Scale'] = this.styleObj.material[el].scale;
                    //         }
                    //     }
                    // }

                    //  Update data
                    this.update();

                    if (this.change) {
                        // Common HEADER
                        this.vertexCode = getVertex(this.tangramPlay.scene, this.shader.uniforms, this.styleObj);
                        this.fragmentCode = getFramgmentHeader(this.tangramPlay.scene, this.shader.uniforms, this.styleObj);

                        if (isNormal) {
                            // NORMAL CORE & ENDING
                            this.fragmentCode += getAddressSceneContent(this.tangramPlay.scene, this.address) +
                                            '\ngl_FragColor = vec4(normal,1.0);\n}';
                        }
                        else if (isColor) {
                            // COLOR CORE & ENDING
                            this.fragmentCode += '\n';
                            if (this.styleObj.shaders.blocks && this.styleObj.shaders.blocks.normal) {
                                for (let i = 0; i < this.styleObj.shaders.blocks.normal.length; i++) {
                                    this.fragmentCode += this.styleObj.shaders.blocks.normal[i] + '\n';
                                }
                            }
                            this.fragmentCode += getAddressSceneContent(this.tangramPlay.scene, this.address) +
                                            '\ngl_FragColor = color;\n}';
                        }

                        // Load load composed shader code
                        this.shader.load(this.fragmentCode, this.vertexCode);

                        this.shader.refreshUniforms();
                        this.update();

                        this.change = false;
                    }

                    this.start();
                }
                else {
                    this.disable();
                }
            }
        }
        else {
            this.disable();
        }
    }

    start() {
        if (!this.active) {
            if (this.shader) {
                this.shader.refreshUniforms();
            }
            this.active = true;
            this.render();
        }
    }

    disable() {
        if (this.active) {
            this.element.parentNode.removeChild(this.element);
        }
        this.stop();
        this.address = '';
    }

    stop() {
        this.active = false;
        this.change = true;
    }

    update() {
        // Update uniforms
        this.uniforms['u_device_pixel_ratio'] = window.devicePixelRatio;
        this.uniforms['u_meters_per_pixel'] = this.tangramPlay.scene['meters_per_pixel'];
        this.uniforms['u_map_position'] = [this.tangramPlay.scene['center_meters'].x, this.tangramPlay.scene['center_meters'].y, this.tangramPlay.scene.zoom];
        this.uniforms['u_tile_origin'] = [this.tangramPlay.scene['center_tile'].x, this.tangramPlay.scene['center_tile'].y, this.tangramPlay.scene['center_tile'].z];
        this.uniforms['u_vanishing_point'] = this.tangramPlay.scene.camera['vanishing_point'];

        this.shader.setUniforms(this.uniforms);
    }

    render() {
        if (this.active) { // && this.animated) {
            this.update();
            this.shader.render(true);
            requestAnimationFrame(function() {
                tangramPlay.editor.glslSandbox.render();
            }, 1000 / 30);
        }
    }

    setColor(colorArray) {
        if (typeof colorArray === 'number') {
            this.uniforms['u_color'] = [colorArray, colorArray, colorArray, 1];
        }
        else if (colorArray.length === 1) {
            this.uniforms['u_color'] = [colorArray[0], colorArray[0], colorArray[0], 1];
        }
        else if (colorArray.length === 3) {
            this.uniforms['u_color'] = [colorArray[0], colorArray[1], colorArray[2], 1];
        }
        else if (colorArray.length === 4) {
            this.uniforms['u_color'] = colorArray;
        }
        let rgbString = 'rgb(' + Math.round(this.uniforms['u_color'][0] * 255) + ',' +
                                Math.round(this.uniforms['u_color'][1] * 255) + ',' +
                                Math.round(this.uniforms['u_color'][2] * 255) + ')';
        this.colorPicker.style.backgroundColor = rgbString;
    }

    /**
     *  Handles when user clicks on the in-line color indicator widget
     */
    onColorClick (event) {
        let pos = getPosition(this.colorPicker);
        pos.x += 30;
        pos.y = this.tangramPlay.editor.heightAtLine(this.line) - 15;

        this.picker = new ColorPickerModal(this.colorPicker.style.backgroundColor);

        this.picker.presentModal(pos.x, pos.y);
        this.picker.on('changed', this.onColorChange.bind(this));
    }

    /**
     *  Handles when user selects a new color on the colorpicker
     */
    onColorChange (event) {
        let color = this.picker.getRGB();
        this.setColor([color.r, color.g, color.b, 1]);
    }

    onCursorMove() {
        let pos = this.tangramPlay.editor.getCursor();

        let edge = this.tangramPlay.editor.charCoords({ line:pos.line, ch:20 }).left;
        let left = this.tangramPlay.editor.charCoords(pos).left;

        if (pos.ch < 20 || left < edge) {
            if (this.active) {
                this.disable();
            }
        }
        else if (pos.line !== this.line || !this.active) {
            this.line = pos.line;
            this.reload(pos.line);
        }
    }
}

function getNumberOfOpenParentesis(str) {
    let counter = 0;
    for (let i = 0; i < str.length; i++) {
        if (str[i] === '{') {
            counter++;
        }
        else if (str[i] === '}') {
            counter--;
        }
    }
    return counter;
};

function getStyleObj(sc, address) {
    let keys = getKeysFromAddress(address);
    if (keys === undefined || keys.length === 0 || sc.styles === undefined || sc.styles === null || sc.styles[keys[1]] === undefined) {
        console.log('Error: No style for ', address);
        return undefined;
    }
    return sc.styles[keys[1]];
}

function getVertex(scene, uniforms, styleObj) {
    let defines = '#define TANGRAM_VERTEX_SHADER\n';

    for (let name in styleObj.defines) {
        if (styleObj.defines[name]) {
            defines += '#define ' + name + (styleObj.defines[name] === true ? '\n' : ' ' + styleObj.defines[name] + '\n');
        }
    }

    let blockUniforms = `

#ifdef GL_ES
precision mediump float;
#endif

const vec3 u_eye = vec3(1.0);

attribute vec3 a_position;
attribute vec2 a_texcoord;

varying vec4 v_position;
varying vec4 v_color;
varying vec4 v_world_position;
varying vec3 v_normal;
varying vec2 v_texcoord;

`;
    for (let u in uniforms) {
        blockUniforms += 'uniform ' + uniforms[u].type + ' ' + uniforms[u].name + ';\n';
    }

    let blockGlobal = '\n';
    if (styleObj.shaders.blocks.global) {
        for (let i = 0; i < styleObj.shaders.blocks.global.length; i++) {
            blockGlobal += styleObj.shaders.blocks.global[i] + '\n';
        }
    }

    let core = `
void main() {
    vec4 position = vec4((a_position.xy*2.0)-1., 0.0, 1.0);
    v_texcoord = (a_texcoord*2.0)-1.;
    v_world_position = vec4(vec3(u_map_position.xy*0.01+(position.xy*u_meters_per_pixel)*50.,u_map_position.z),1.);
 `;

    let blockPosition = '\n';
    if (styleObj.shaders.blocks.position) {
        for (let i = 0; i < styleObj.shaders.blocks.position.length; i++) {
            blockPosition += styleObj.shaders.blocks.position[i] + '\n';
        }
    }

    let ending = `
    v_position = position;
    gl_Position = position;
    v_normal = vec3(0.,0.,1.);
    v_color =['u_color'];
}
`;

    return defines + blockUniforms + blockGlobal + core + blockPosition + ending;
}

function getFramgmentHeader(scene, uniforms, styleObj) {
    let defines = '#define TANGRAM_FRAGMENT_SHADER\n';

    for (let name in styleObj.defines) {
        if (styleObj.defines[name]) {
            defines += '#define ' + name + (styleObj.defines[name] === true ? '\n' : ' ' + styleObj.defines[name] + '\n');
        }
    }

    let blockMaterial = '\n';
    if (styleObj.shaders.blocks.material) {
        for (let i = 0; i < styleObj.shaders.blocks.material.length; i++) {
            blockMaterial += styleObj.shaders.blocks.material[i] + '\n';
        }
    }

    let blockUniforms = `

#ifdef GL_ES
precision mediump float;
#endif

const vec3 u_eye = vec3(1.0);

varying vec4 v_position;
varying vec4 v_color;
varying vec4 v_world_position;
varying vec3 v_normal;
varying vec2 v_texcoord;
`;
    for (let u in uniforms) {
        blockUniforms += 'uniform ' + uniforms[u].type + ' ' + uniforms[u].name + ';\n';
    }

    let blockGlobal = '\n';
    if (styleObj.shaders.blocks.global) {
        for (let i = 0; i < styleObj.shaders.blocks.global.length; i++) {
            blockGlobal += styleObj.shaders.blocks.global[i] + '\n';
        }
    }

    let pre = `
void main() {
    vec4 color = v_color;
    vec3 normal = v_normal;
`;

    return defines + blockUniforms + blockMaterial + blockGlobal + pre;
}
