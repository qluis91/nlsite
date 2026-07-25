/** Vanilla adaptation of React Bits' Splash Cursor fluid simulation. */
const active = new WeakMap();

const defaults = {
  SIM_RESOLUTION: 128, DYE_RESOLUTION: 1440, CAPTURE_RESOLUTION: 512,
  DENSITY_DISSIPATION: 5.5, VELOCITY_DISSIPATION: 1.5,
  PRESSURE: 0.2, PRESSURE_ITERATIONS: 20, CURL: 3,
  SPLAT_RADIUS: 0.2, SPLAT_FORCE: 6000, SHADING: true,
  COLOR_UPDATE_SPEED: 10, BACK_COLOR: { r: 0, g: 0, b: 0 },
  TRANSPARENT: true, RAINBOW_MODE: false, COLOR: '#93eb0d',
};

function inactiveController() {
  return Object.freeze({
    pause() {}, resume() {}, destroy() {}, isActive: () => false,
  });
}

const vertex = `precision highp float;attribute vec2 aPosition;varying vec2 vUv,vL,vR,vT,vB;uniform vec2 texelSize;void main(){vUv=aPosition*.5+.5;vL=vUv-vec2(texelSize.x,0);vR=vUv+vec2(texelSize.x,0);vT=vUv+vec2(0,texelSize.y);vB=vUv-vec2(0,texelSize.y);gl_Position=vec4(aPosition,0,1);}`;
const copy = `precision mediump float;varying highp vec2 vUv;uniform sampler2D uTexture;void main(){gl_FragColor=texture2D(uTexture,vUv);}`;
const clear = `precision mediump float;varying highp vec2 vUv;uniform sampler2D uTexture;uniform float value;void main(){gl_FragColor=value*texture2D(uTexture,vUv);}`;
const splatShader = `precision highp float;varying vec2 vUv;uniform sampler2D uTarget;uniform float aspectRatio;uniform vec3 color;uniform vec2 point;uniform float radius;void main(){vec2 p=vUv-point;p.x*=aspectRatio;vec3 s=exp(-dot(p,p)/radius)*color;gl_FragColor=vec4(texture2D(uTarget,vUv).xyz+s,1);}`;
const advection = `precision highp float;varying vec2 vUv;uniform sampler2D uVelocity,uSource;uniform vec2 texelSize,dyeTexelSize;uniform float dt,dissipation;vec4 bilerp(sampler2D s,vec2 uv,vec2 ts){vec2 st=uv/ts-.5;vec2 i=floor(st),f=fract(st);vec4 a=texture2D(s,(i+vec2(.5,.5))*ts),b=texture2D(s,(i+vec2(1.5,.5))*ts),c=texture2D(s,(i+vec2(.5,1.5))*ts),d=texture2D(s,(i+vec2(1.5,1.5))*ts);return mix(mix(a,b,f.x),mix(c,d,f.x),f.y);}void main(){vec2 v=bilerp(uVelocity,vUv,texelSize).xy;gl_FragColor=dissipation*bilerp(uSource,vUv-dt*v*texelSize,dyeTexelSize);gl_FragColor.a=1.;}`;
const divergenceShader = `precision mediump float;varying highp vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVelocity;void main(){float L=texture2D(uVelocity,vL).x,R=texture2D(uVelocity,vR).x,T=texture2D(uVelocity,vT).y,B=texture2D(uVelocity,vB).y;vec2 C=texture2D(uVelocity,vUv).xy;if(vL.x<0.)L=-C.x;if(vR.x>1.)R=-C.x;if(vT.y>1.)T=-C.y;if(vB.y<0.)B=-C.y;gl_FragColor=vec4(.5*(R-L+T-B),0,0,1);}`;
const curlShader = `precision mediump float;varying highp vec2 vL,vR,vT,vB;uniform sampler2D uVelocity;void main(){float L=texture2D(uVelocity,vL).y,R=texture2D(uVelocity,vR).y,T=texture2D(uVelocity,vT).x,B=texture2D(uVelocity,vB).x;gl_FragColor=vec4(.5*(R-L-T+B),0,0,1);}`;
const vorticity = `precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uVelocity,uCurl;uniform float curl,dt;void main(){float L=texture2D(uCurl,vL).x,R=texture2D(uCurl,vR).x,T=texture2D(uCurl,vT).x,B=texture2D(uCurl,vB).x,C=texture2D(uCurl,vUv).x;vec2 f=.5*vec2(abs(T)-abs(B),abs(R)-abs(L));f/=length(f)+.0001;f*=curl*C;f.y*=-1.;vec2 v=texture2D(uVelocity,vUv).xy+f*dt;gl_FragColor=vec4(clamp(v,-1000.,1000.),0,1);}`;
const pressureShader = `precision mediump float;varying highp vec2 vUv,vL,vR,vT,vB;uniform sampler2D uPressure,uDivergence;void main(){float L=texture2D(uPressure,vL).x,R=texture2D(uPressure,vR).x,T=texture2D(uPressure,vT).x,B=texture2D(uPressure,vB).x,D=texture2D(uDivergence,vUv).x;gl_FragColor=vec4((L+R+B+T-D)*.25,0,0,1);}`;
const gradient = `precision mediump float;varying highp vec2 vUv,vL,vR,vT,vB;uniform sampler2D uPressure,uVelocity;void main(){float L=texture2D(uPressure,vL).x,R=texture2D(uPressure,vR).x,T=texture2D(uPressure,vT).x,B=texture2D(uPressure,vB).x;vec2 v=texture2D(uVelocity,vUv).xy-vec2(R-L,T-B);gl_FragColor=vec4(v,0,1);}`;
const display = `precision highp float;varying vec2 vUv,vL,vR,vT,vB;uniform sampler2D uTexture;uniform vec2 texelSize;uniform vec3 backColor;uniform float transparent,shading;void main(){vec3 c=texture2D(uTexture,vUv).rgb;if(shading>.5){float l=length(texture2D(uTexture,vL).rgb),r=length(texture2D(uTexture,vR).rgb),t=length(texture2D(uTexture,vT).rgb),b=length(texture2D(uTexture,vB).rgb);vec3 n=normalize(vec3(r-l,t-b,length(texelSize)));c*=clamp(dot(n,vec3(0,0,1))+.7,.7,1.);}float a=max(c.r,max(c.g,c.b));gl_FragColor=transparent>.5?vec4(c,a):vec4(mix(backColor,c,a),1);}`;

function resolveCanvas(value) {
  if (value instanceof HTMLCanvasElement) return { canvas: value, owner: null };
  const found = typeof value === 'string' ? document.querySelector(value) : null;
  if (found instanceof HTMLCanvasElement) return { canvas: found, owner: null };
  const home = document.querySelector('[data-home-page]');
  if (!home) return { canvas: null, owner: null };
  const owner = document.createElement('div');
  owner.className = 'splash-cursor-layer'; owner.setAttribute('aria-hidden', 'true');
  const canvas = document.createElement('canvas');
  canvas.className = 'splash-cursor-canvas'; canvas.dataset.splashCursor = '';
  owner.append(canvas); home.prepend(owner);
  return { canvas, owner };
}

function colorFromHex(hex) {
  const raw = String(hex).replace('#', '');
  const text = raw.length === 3 ? [...raw].map((c) => c + c).join('') : raw;
  const n = Number.parseInt(text, 16);
  return { r: ((n >> 16) & 255) / 1700, g: ((n >> 8) & 255) / 1700, b: (n & 255) / 1700 };
}

export function initSplashCursor(options = {}) {
  const { canvas: requested, startPaused = false, ...overrides } = options;
  const touchOnly = window.matchMedia('(pointer: coarse)').matches
    || (navigator.maxTouchPoints || 0) > 0;
  if (touchOnly) return inactiveController();

  const config = { ...defaults, ...overrides };
  const resolved = resolveCanvas(requested);
  const canvas = resolved.canvas;
  if (!canvas) return inactiveController();
  if (active.has(canvas)) return active.get(canvas);

  let gl = null, raf = null, resizeTimer = null, dead = false;
  let paused = Boolean(startPaused), pointerListenersBound = false;
  let last = performance.now();
  let schedule = () => {}; let frame = () => {};
  let visibility = () => {}; let queueResize = () => {};
  let pointerDown = () => {}, pointerMove = () => {}, pointerEnd = () => {};
  let velocity, dye, divergence, curl, pressure;
  const pointers = new Map();
  const resources = { buffers: new Set(), fbos: new Set(), programs: new Set(), shaders: new Set(), textures: new Set() };

  function bindPointerListeners() {
    if (pointerListenersBound || dead) return;
    pointerListenersBound = true;
    window.addEventListener('pointerdown',pointerDown,{passive:true});window.addEventListener('pointermove',pointerMove,{passive:true});
    window.addEventListener('pointerup',pointerEnd,{passive:true});window.addEventListener('pointercancel',pointerEnd,{passive:true});
  }
  function unbindPointerListeners() {
    if (!pointerListenersBound) return;
    pointerListenersBound = false;
    window.removeEventListener('pointerdown',pointerDown);window.removeEventListener('pointermove',pointerMove);
    window.removeEventListener('pointerup',pointerEnd);window.removeEventListener('pointercancel',pointerEnd);
  }

  function destroy() {
    if (dead) return; dead = true;
    if (raf !== null) cancelAnimationFrame(raf); clearTimeout(resizeTimer);
    unbindPointerListeners();
    window.removeEventListener('resize', queueResize); window.removeEventListener('pagehide', destroy);
    document.removeEventListener('visibilitychange', visibility); canvas.removeEventListener('webglcontextlost', contextLost);
    if (gl) {
      resources.fbos.forEach((x) => gl.deleteFramebuffer(x)); resources.textures.forEach((x) => gl.deleteTexture(x));
      resources.programs.forEach((x) => gl.deleteProgram(x)); resources.shaders.forEach((x) => gl.deleteShader(x));
      resources.buffers.forEach((x) => gl.deleteBuffer(x));
    }
    pointers.clear(); resolved.owner?.remove(); if (active.get(canvas) === controller) active.delete(canvas);
  }
  function pause() {
    if (dead || paused) return;
    paused = true;
    canvas.classList.add('is-paused');
    unbindPointerListeners();
    pointers.clear();
    if (raf !== null) cancelAnimationFrame(raf);
    raf = null;
  }
  function resume() {
    if (dead || !paused) return;
    paused = false;
    canvas.classList.remove('is-paused');
    bindPointerListeners();
    last = performance.now();
    schedule();
  }
  const controller = Object.freeze({
    pause, resume, destroy, isActive: () => !dead && !paused,
  });
  active.set(canvas, controller);
  function contextLost() { console.warn('[splash-cursor] WebGL context lost; effect stopped.'); destroy(); }

  try {
    const attrs = { alpha: true, antialias: false, depth: false, stencil: false, premultipliedAlpha: false, preserveDrawingBuffer: false };
    gl = canvas.getContext('webgl2', attrs);
    const webgl2 = Boolean(gl);
    gl ||= canvas.getContext('webgl', attrs) || canvas.getContext('experimental-webgl', attrs);
    if (!gl) throw new Error('WebGL is unavailable');

    let half, rgba, rg, r, fluidFiltering = gl.NEAREST;
    function supported(internal, format, type) {
      const t = gl.createTexture(), f = gl.createFramebuffer(); if (!t || !f) return false;
      gl.bindTexture(gl.TEXTURE_2D, t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.texImage2D(gl.TEXTURE_2D, 0, internal, 4, 4, 0, format, type, null);
      gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE; gl.deleteTexture(t); gl.deleteFramebuffer(f); return ok;
    }
    function format(internal, base, type) {
      if (supported(internal, base, type)) return { internal, base };
      if (webgl2 && internal === gl.R16F) return format(gl.RG16F, gl.RG, type);
      if (webgl2 && internal === gl.RG16F) return format(gl.RGBA16F, gl.RGBA, type);
      return null;
    }
    if (webgl2) {
      gl.getExtension('EXT_color_buffer_float');
      if (gl.getExtension('OES_texture_float_linear')) fluidFiltering = gl.LINEAR;
      half = gl.HALF_FLOAT;
      rgba = format(gl.RGBA16F, gl.RGBA, half); rg = format(gl.RG16F, gl.RG, half); r = format(gl.R16F, gl.RED, half);
    } else {
      const ext = gl.getExtension('OES_texture_half_float'); if (!ext) throw new Error('Half-float textures unavailable');
      if (gl.getExtension('OES_texture_half_float_linear')) fluidFiltering = gl.LINEAR;
      half = ext.HALF_FLOAT_OES; rgba = rg = r = format(gl.RGBA, gl.RGBA, half);
    }
    if (!rgba || !rg || !r) throw new Error('Renderable texture formats unavailable');
    gl.clearColor(0, 0, 0, 0); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE);

    function shader(type, source) {
      const s = gl.createShader(type); gl.shaderSource(s, source); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const msg = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(msg); }
      resources.shaders.add(s); return s;
    }
    const vs = shader(gl.VERTEX_SHADER, vertex);
    function program(source) {
      const p = gl.createProgram(), fs = shader(gl.FRAGMENT_SHADER, source); gl.attachShader(p, vs); gl.attachShader(p, fs);
      gl.bindAttribLocation(p, 0, 'aPosition'); gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p)); resources.programs.add(p);
      const u = {}; for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i += 1) { const info = gl.getActiveUniform(p, i); u[info.name] = gl.getUniformLocation(p, info.name); }
      return { p, u };
    }
    const P = { copy: program(copy), clear: program(clear), splat: program(splatShader), advection: program(advection), divergence: program(divergenceShader), curl: program(curlShader), vorticity: program(vorticity), pressure: program(pressureShader), gradient: program(gradient), display: program(display) };
    const vb = gl.createBuffer(), ib = gl.createBuffer(); resources.buffers.add(vb); resources.buffers.add(ib);
    gl.bindBuffer(gl.ARRAY_BUFFER, vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,-1,1,1,1,1,-1]), gl.STATIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array([0,1,2,0,2,3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const use = (bundle) => { gl.useProgram(bundle.p); return bundle.u; };
    function blit(target, erase = false) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, target?.fbo || null); gl.viewport(0, 0, target?.width || gl.drawingBufferWidth, target?.height || gl.drawingBufferHeight);
      if (erase) { gl.clearColor(0,0,0,0); gl.clear(gl.COLOR_BUFFER_BIT); } gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
    }
    function fbo(width, height, spec, filtering = gl.NEAREST) {
      const texture = gl.createTexture(), frame = gl.createFramebuffer(); resources.textures.add(texture); resources.fbos.add(frame);
      gl.bindTexture(gl.TEXTURE_2D, texture); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filtering); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filtering);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, spec.internal, width, height, 0, spec.base, half, null); gl.bindFramebuffer(gl.FRAMEBUFFER, frame);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0); gl.clear(gl.COLOR_BUFFER_BIT);
      return { fbo: frame, texture, width, height, tx: 1/width, ty: 1/height, attach(id) { gl.activeTexture(gl.TEXTURE0+id); gl.bindTexture(gl.TEXTURE_2D, texture); return id; } };
    }
    const doubleFbo = (w,h,s,f) => { let a=fbo(w,h,s,f),b=fbo(w,h,s,f); return { get read(){return a;},get write(){return b;},swap(){[a,b]=[b,a];} }; };
    function dispose(x) { if (!x) return; gl.deleteTexture(x.texture); gl.deleteFramebuffer(x.fbo); resources.textures.delete(x.texture); resources.fbos.delete(x.fbo); }
    function disposeDouble(x) { if (x) { dispose(x.read); dispose(x.write); } }
    function size(base) { const aspect=gl.drawingBufferWidth/Math.max(gl.drawingBufferHeight,1); return aspect<1?{width:Math.round(base),height:Math.round(base/aspect)}:{width:Math.round(base*aspect),height:Math.round(base)}; }
    function bases() { return innerWidth<=768?{sim:Math.min(config.SIM_RESOLUTION,64),dye:Math.min(config.DYE_RESOLUTION,512)}:innerWidth<=1024?{sim:Math.min(config.SIM_RESOLUTION,96),dye:Math.min(config.DYE_RESOLUTION,768)}:{sim:config.SIM_RESOLUTION,dye:config.DYE_RESOLUTION}; }
    function resizeCanvas() { const d=Math.min(devicePixelRatio||1,1.5); canvas.width=Math.max(1,Math.floor(canvas.clientWidth*d)); canvas.height=Math.max(1,Math.floor(canvas.clientHeight*d)); }
    function initFbos() {
      const b=bases(),s=size(b.sim),d=size(b.dye); disposeDouble(velocity);disposeDouble(dye);dispose(divergence);dispose(curl);disposeDouble(pressure);
      velocity=doubleFbo(s.width,s.height,rg,fluidFiltering); dye=doubleFbo(d.width,d.height,rgba,fluidFiltering);
      divergence=fbo(s.width,s.height,r); curl=fbo(s.width,s.height,r); pressure=doubleFbo(s.width,s.height,r,gl.NEAREST);
    }
    resizeCanvas(); initFbos();

    function splat(x,y,dx,dy,color) {
      gl.disable(gl.BLEND); let u=use(P.splat); gl.uniform1i(u.uTarget,velocity.read.attach(0)); gl.uniform1f(u.aspectRatio,canvas.width/canvas.height);
      gl.uniform2f(u.point,x,y); gl.uniform3f(u.color,dx,dy,0); gl.uniform1f(u.radius,(config.SPLAT_RADIUS/100)*Math.max(1,canvas.width/canvas.height)); blit(velocity.write);velocity.swap();
      u=use(P.splat); gl.uniform1i(u.uTarget,dye.read.attach(0)); gl.uniform1f(u.aspectRatio,canvas.width/canvas.height); gl.uniform2f(u.point,x,y);
      gl.uniform3f(u.color,color.r,color.g,color.b); gl.uniform1f(u.radius,(config.SPLAT_RADIUS/100)*Math.max(1,canvas.width/canvas.height));blit(dye.write);dye.swap();
    }
    function getPointer(e) { if(!pointers.has(e.pointerId)) pointers.set(e.pointerId,{init:false,moved:false,x:0,y:0,dx:0,dy:0,color:colorFromHex(config.COLOR)}); return pointers.get(e.pointerId); }
    function update(p,e) { const rect=canvas.getBoundingClientRect(),x=Math.max(0,Math.min(1,(e.clientX-rect.left)/rect.width)),y=Math.max(0,Math.min(1,1-(e.clientY-rect.top)/rect.height)); if(!p.init){p.init=true;p.x=x;p.y=y;return false;}p.dx=x-p.x;p.dy=y-p.y;p.x=x;p.y=y;p.moved=Math.abs(p.dx)+Math.abs(p.dy)>0;return p.moved; }
    pointerDown=(e)=>{const p=getPointer(e);update(p,e);splat(p.x,p.y,0,0,p.color);}; pointerMove=(e)=>{update(getPointer(e),e);}; pointerEnd=(e)=>{if(e.pointerType!=='mouse')pointers.delete(e.pointerId);};
    function inputs(){pointers.forEach((p)=>{if(p.moved){p.moved=false;splat(p.x,p.y,p.dx*config.SPLAT_FORCE,p.dy*config.SPLAT_FORCE,p.color);}});}
    function step(dt) {
      gl.disable(gl.BLEND); let u=use(P.curl);gl.uniform2f(u.texelSize,velocity.read.tx,velocity.read.ty);gl.uniform1i(u.uVelocity,velocity.read.attach(0));blit(curl);
      u=use(P.vorticity);gl.uniform2f(u.texelSize,velocity.read.tx,velocity.read.ty);gl.uniform1i(u.uVelocity,velocity.read.attach(0));gl.uniform1i(u.uCurl,curl.attach(1));gl.uniform1f(u.curl,config.CURL);gl.uniform1f(u.dt,dt);blit(velocity.write);velocity.swap();
      u=use(P.divergence);gl.uniform2f(u.texelSize,velocity.read.tx,velocity.read.ty);gl.uniform1i(u.uVelocity,velocity.read.attach(0));blit(divergence);
      u=use(P.clear);gl.uniform2f(u.texelSize,pressure.read.tx,pressure.read.ty);gl.uniform1i(u.uTexture,pressure.read.attach(0));gl.uniform1f(u.value,config.PRESSURE);blit(pressure.write);pressure.swap();
      u=use(P.pressure);gl.uniform2f(u.texelSize,pressure.read.tx,pressure.read.ty);gl.uniform1i(u.uDivergence,divergence.attach(0));for(let i=0;i<config.PRESSURE_ITERATIONS;i+=1){gl.uniform1i(u.uPressure,pressure.read.attach(1));blit(pressure.write);pressure.swap();}
      u=use(P.gradient);gl.uniform2f(u.texelSize,velocity.read.tx,velocity.read.ty);gl.uniform1i(u.uPressure,pressure.read.attach(0));gl.uniform1i(u.uVelocity,velocity.read.attach(1));blit(velocity.write);velocity.swap();
      u=use(P.advection);gl.uniform2f(u.texelSize,velocity.read.tx,velocity.read.ty);gl.uniform2f(u.dyeTexelSize,velocity.read.tx,velocity.read.ty);gl.uniform1i(u.uVelocity,velocity.read.attach(0));gl.uniform1i(u.uSource,velocity.read.attach(0));gl.uniform1f(u.dt,dt);gl.uniform1f(u.dissipation,1/(1+config.VELOCITY_DISSIPATION*dt));blit(velocity.write);velocity.swap();
      gl.uniform2f(u.dyeTexelSize,dye.read.tx,dye.read.ty);gl.uniform1i(u.uVelocity,velocity.read.attach(0));gl.uniform1i(u.uSource,dye.read.attach(1));gl.uniform1f(u.dissipation,1/(1+config.DENSITY_DISSIPATION*dt));blit(dye.write);dye.swap();
    }
    function render(){const u=use(P.display);gl.uniform2f(u.texelSize,dye.read.tx,dye.read.ty);gl.uniform1i(u.uTexture,dye.read.attach(0));gl.uniform3f(u.backColor,config.BACK_COLOR.r,config.BACK_COLOR.g,config.BACK_COLOR.b);gl.uniform1f(u.transparent,config.TRANSPARENT?1:0);gl.uniform1f(u.shading,config.SHADING?1:0);gl.enable(gl.BLEND);gl.blendFunc(gl.ONE,gl.ONE_MINUS_SRC_ALPHA);blit(null,true);}
    last=performance.now();
    schedule=function schedule(){if(!dead&&!paused&&!document.hidden&&raf===null)raf=requestAnimationFrame(frame);};
    frame=function frame(now){raf=null;if(dead||paused||document.hidden)return;const dt=Math.min((now-last)/1000,1/30);last=now;inputs();step(dt);render();schedule();};
    visibility=function visibility(){if(document.hidden){if(raf!==null)cancelAnimationFrame(raf);raf=null;}else{last=performance.now();schedule();}};
    queueResize=function queueResize(){clearTimeout(resizeTimer);resizeTimer=setTimeout(()=>{if(!dead){resizeCanvas();initFbos();}},140);};
    if (!paused) bindPointerListeners();
    canvas.classList.toggle('is-paused', paused);
    window.addEventListener('resize',queueResize,{passive:true});window.addEventListener('pagehide',destroy,{once:true});document.addEventListener('visibilitychange',visibility);canvas.addEventListener('webglcontextlost',contextLost,{once:true});schedule();
  } catch (error) { console.warn('[splash-cursor] Effect unavailable:', error); destroy(); }
  return controller;
}
