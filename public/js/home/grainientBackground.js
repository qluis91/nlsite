/** Raw-WebGL port of the React Bits Grainient fullscreen-triangle renderer. */
const instances = new WeakMap();

const defaults = {
  color1: '#b1bac6', color2: '#73767a', color3: '#000000',
  timeSpeed: 0.25, colorBalance: 0,
  warpStrength: 1.7, warpFrequency: 3.5, warpSpeed: 3.3, warpAmplitude: 80,
  blendAngle: 120, blendSoftness: 0.12, rotationAmount: 0,
  noiseScale: 0.65, grainAmount: 0, grainScale: 0.7, grainAnimated: false,
  contrast: 1.3, gamma: 1.55, saturation: 0.75,
  centerX: -0.36, centerY: 0.09, zoom: 0.95,
};

const vertexBody = `
void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const fragmentBody = `
precision highp float;
uniform vec2 iResolution;
uniform float iTime, uTimeSpeed, uColorBalance, uWarpStrength, uWarpFrequency;
uniform float uWarpSpeed, uWarpAmplitude, uBlendAngle, uBlendSoftness;
uniform float uRotationAmount, uNoiseScale, uGrainAmount, uGrainScale;
uniform float uGrainAnimated, uContrast, uGamma, uSaturation, uZoom;
uniform vec2 uCenterOffset;
uniform vec3 uColor1, uColor2, uColor3;
#define S(a,b,t) smoothstep(a,b,t)
mat2 Rot(float a){float s=sin(a),c=cos(a);return mat2(c,-s,s,c);}
vec2 hash(vec2 p){p=vec2(dot(p,vec2(2127.1,81.17)),dot(p,vec2(1269.5,283.37)));return fract(sin(p)*43758.5453);}
float noise(vec2 p){
  vec2 i=floor(p),f=fract(p),u=f*f*(3.0-2.0*f);
  float n=mix(
    mix(dot(-1.0+2.0*hash(i),f),dot(-1.0+2.0*hash(i+vec2(1,0)),f-vec2(1,0)),u.x),
    mix(dot(-1.0+2.0*hash(i+vec2(0,1)),f-vec2(0,1)),dot(-1.0+2.0*hash(i+vec2(1)),f-vec2(1)),u.x),u.y);
  return 0.5+0.5*n;
}
vec4 grainient(vec2 C){
  float t=iTime*uTimeSpeed;
  vec2 uv=C/iResolution.xy;
  float ratio=iResolution.x/iResolution.y;
  vec2 tuv=uv-0.5+uCenterOffset;
  tuv/=max(uZoom,0.001);
  float degree=noise(vec2(t*0.1,tuv.x*tuv.y)*uNoiseScale);
  tuv.y*=1.0/ratio;
  tuv*=Rot(radians((degree-0.5)*uRotationAmount+180.0));
  tuv.y*=ratio;
  float amplitude=uWarpAmplitude/max(uWarpStrength,0.001);
  float warpTime=t*uWarpSpeed;
  tuv.x+=sin(tuv.y*uWarpFrequency+warpTime)/amplitude;
  tuv.y+=sin(tuv.x*(uWarpFrequency*1.5)+warpTime)/(amplitude*0.5);
  float b=uColorBalance,s=max(uBlendSoftness,0.0);
  float blendX=(tuv*Rot(radians(uBlendAngle))).x;
  float edge0=-0.3-b-s,edge1=0.2-b+s,v0=0.5-b+s,v1=-0.3-b-s;
  vec3 layer1=mix(uColor3,uColor2,S(edge0,edge1,blendX));
  vec3 layer2=mix(uColor2,uColor1,S(edge0,edge1,blendX));
  vec3 col=mix(layer1,layer2,S(v0,v1,tuv.y));
  vec2 grainUv=uv*max(uGrainScale,0.001);
  if(uGrainAnimated>0.5)grainUv+=vec2(iTime*0.05);
  float grain=fract(sin(dot(grainUv,vec2(12.9898,78.233)))*43758.5453);
  col+=(grain-0.5)*uGrainAmount;
  col=(col-0.5)*uContrast+0.5;
  float luma=dot(col,vec3(0.2126,0.7152,0.0722));
  col=mix(vec3(luma),col,uSaturation);
  col=pow(max(col,0.0),vec3(1.0/max(uGamma,0.001)));
  return vec4(clamp(col,0.0,1.0),1.0);
}
`;

function shaderSources(webgl2) {
  return webgl2 ? {
    vertex: `#version 300 es\nin vec2 position;${vertexBody}`,
    fragment: `#version 300 es\n${fragmentBody}\nout vec4 fragColor;void main(){fragColor=grainient(gl_FragCoord.xy);}`,
  } : {
    vertex: `attribute vec2 position;${vertexBody}`,
    fragment: `${fragmentBody}\nvoid main(){gl_FragColor=grainient(gl_FragCoord.xy);}`,
  };
}

function rgb(hex) {
  const match = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(String(hex));
  return match ? [1, 2, 3].map((index) => Number.parseInt(match[index], 16) / 255) : [1, 1, 1];
}

function resolveCanvas(value) {
  if (value instanceof HTMLCanvasElement) return { canvas: value, owner: null };
  const selected = typeof value === 'string' ? document.querySelector(value) : null;
  if (selected instanceof HTMLCanvasElement) return { canvas: selected, owner: null };
  const home = document.querySelector('[data-home-page]');
  if (!home) return { canvas: null, owner: null };
  const owner = document.createElement('div');
  owner.className = 'grainient-background'; owner.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'grainient-background__canvas'; canvas.dataset.grainientCanvas = '';
  owner.append(canvas); home.prepend(owner);
  return { canvas, owner };
}

function internalScale() {
  if (window.innerWidth <= 768) return 0.6;
  if (window.innerWidth <= 1024) return 0.75;
  return 0.9;
}

export function initGrainientBackground(options = {}) {
  const { canvas: requestedCanvas, ...overrides } = options;
  const config = { ...defaults, ...overrides };
  const resolved = resolveCanvas(requestedCanvas);
  const canvas = resolved.canvas;
  if (!canvas) return () => {};
  if (instances.has(canvas)) return instances.get(canvas);

  let gl=null,program=null,vertexShader=null,fragmentShader=null,buffer=null;
  let rafId=null,resizeTimer=null,destroyed=false,lost=false,elapsed=0,last=performance.now();
  let queueResize=()=>{},visibility=()=>{},contextLost=()=>{},contextRestored=()=>{};

  function stop(){if(rafId!==null)cancelAnimationFrame(rafId);rafId=null;}
  function cleanup(){
    if(destroyed)return;destroyed=true;stop();clearTimeout(resizeTimer);
    window.removeEventListener('resize',queueResize);window.removeEventListener('pagehide',cleanup);
    document.removeEventListener('visibilitychange',visibility);
    canvas.removeEventListener('webglcontextlost',contextLost);canvas.removeEventListener('webglcontextrestored',contextRestored);
    if(gl&&!lost){if(buffer)gl.deleteBuffer(buffer);if(program)gl.deleteProgram(program);if(vertexShader)gl.deleteShader(vertexShader);if(fragmentShader)gl.deleteShader(fragmentShader);}
    resolved.owner?.remove();if(instances.get(canvas)===cleanup)instances.delete(canvas);
  }
  instances.set(canvas,cleanup);

  function compile(type,source,label){
    const shader=gl.createShader(type);if(!shader)throw new Error(`Unable to create ${label} shader.`);
    gl.shaderSource(shader,source);gl.compileShader(shader);
    if(!gl.getShaderParameter(shader,gl.COMPILE_STATUS)){const details=gl.getShaderInfoLog(shader)||'Unknown error';gl.deleteShader(shader);throw new Error(`${label} shader: ${details}`);}
    return shader;
  }

  try{
    const attrs={alpha:false,antialias:false,depth:false,stencil:false,preserveDrawingBuffer:false,powerPreference:'low-power'};
    gl=canvas.getContext('webgl2',attrs);const webgl2=Boolean(gl);
    gl||=canvas.getContext('webgl',attrs)||canvas.getContext('experimental-webgl',attrs);
    if(!gl){console.warn('[Grainient] WebGL is unavailable.');cleanup();return cleanup;}
    const source=shaderSources(webgl2);
    vertexShader=compile(gl.VERTEX_SHADER,source.vertex,'Vertex');fragmentShader=compile(gl.FRAGMENT_SHADER,source.fragment,'Fragment');
    program=gl.createProgram();if(!program)throw new Error('Unable to create shader program.');
    gl.attachShader(program,vertexShader);gl.attachShader(program,fragmentShader);gl.bindAttribLocation(program,0,'position');gl.linkProgram(program);
    if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw new Error(gl.getProgramInfoLog(program)||'Program linking failed.');
    const names=['iResolution','iTime','uTimeSpeed','uColorBalance','uWarpStrength','uWarpFrequency','uWarpSpeed','uWarpAmplitude','uBlendAngle','uBlendSoftness','uRotationAmount','uNoiseScale','uGrainAmount','uGrainScale','uGrainAnimated','uContrast','uGamma','uSaturation','uCenterOffset','uZoom','uColor1','uColor2','uColor3'];
    const u={};names.forEach((name)=>{u[name]=gl.getUniformLocation(program,name);if(u[name]===null)throw new Error(`Required uniform ${name} is unavailable.`);});
    const position=gl.getAttribLocation(program,'position');if(position<0)throw new Error('Position attribute is unavailable.');
    buffer=gl.createBuffer();if(!buffer)throw new Error('Unable to create triangle buffer.');
    gl.bindBuffer(gl.ARRAY_BUFFER,buffer);gl.bufferData(gl.ARRAY_BUFFER,new Float32Array([-1,-1,3,-1,-1,3]),gl.STATIC_DRAW);
    gl.useProgram(program);gl.enableVertexAttribArray(position);gl.vertexAttribPointer(position,2,gl.FLOAT,false,0,0);
    gl.uniform1f(u.uTimeSpeed,config.timeSpeed);gl.uniform1f(u.uColorBalance,config.colorBalance);
    gl.uniform1f(u.uWarpStrength,config.warpStrength);gl.uniform1f(u.uWarpFrequency,config.warpFrequency);gl.uniform1f(u.uWarpSpeed,config.warpSpeed);gl.uniform1f(u.uWarpAmplitude,config.warpAmplitude);
    gl.uniform1f(u.uBlendAngle,config.blendAngle);gl.uniform1f(u.uBlendSoftness,config.blendSoftness);gl.uniform1f(u.uRotationAmount,config.rotationAmount);gl.uniform1f(u.uNoiseScale,config.noiseScale);
    gl.uniform1f(u.uGrainAmount,config.grainAmount);gl.uniform1f(u.uGrainScale,config.grainScale);gl.uniform1f(u.uGrainAnimated,config.grainAnimated?1:0);
    gl.uniform1f(u.uContrast,config.contrast);gl.uniform1f(u.uGamma,config.gamma);gl.uniform1f(u.uSaturation,config.saturation);
    gl.uniform2f(u.uCenterOffset,config.centerX,config.centerY);gl.uniform1f(u.uZoom,config.zoom);
    gl.uniform3fv(u.uColor1,rgb(config.color1));gl.uniform3fv(u.uColor2,rgb(config.color2));gl.uniform3fv(u.uColor3,rgb(config.color3));

    function resize(){
      const dpr=Math.min(window.devicePixelRatio||1,1.25),scale=internalScale();
      const width=Math.max(1,Math.floor(window.innerWidth*dpr*scale)),height=Math.max(1,Math.floor(window.innerHeight*dpr*scale));
      if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
      gl.viewport(0,0,width,height);gl.uniform2f(u.iResolution,width,height);
    }
    function render(){gl.uniform1f(u.iTime,elapsed);gl.drawArrays(gl.TRIANGLES,0,3);}
    function schedule(){if(!destroyed&&!lost&&!document.hidden&&rafId===null)rafId=requestAnimationFrame(frame);}
    function frame(now){rafId=null;if(destroyed||lost||document.hidden)return;elapsed+=Math.min((now-last)/1000,0.1);last=now;render();schedule();}
    queueResize=()=>{clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!destroyed&&!lost){resize();render();}},150);};
    visibility=()=>{if(document.hidden)stop();else{last=performance.now();schedule();}};
    contextLost=(event)=>{event.preventDefault();lost=true;stop();console.warn('[Grainient] WebGL context lost; background paused.');};
    contextRestored=()=>{console.warn('[Grainient] WebGL context restored; rebuilding background.');cleanup();initGrainientBackground({...config,canvas});};
    window.addEventListener('resize',queueResize,{passive:true});window.addEventListener('pagehide',cleanup,{once:true});
    document.addEventListener('visibilitychange',visibility);canvas.addEventListener('webglcontextlost',contextLost);canvas.addEventListener('webglcontextrestored',contextRestored);
    resize();render();schedule();
  }catch(error){console.warn('[Grainient] Background initialization failed.',error);cleanup();}
  return cleanup;
}
