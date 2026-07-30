/* ============================================================================
 *  Love Story · 清新浪漫版（白天）
 *  蓝天白云、暖阳、彩虹之下，一棵樱花树缓缓生长、绽放、落瓣。
 *  明媚 · 干净 · 治愈。
 * ==========================================================================*/
(function () {
    'use strict';

    var canvas = document.getElementById('canvas');
    if (!canvas || !canvas.getContext) {
        var err = document.getElementById('error');
        if (err) err.style.display = 'block';
        return;
    }
    var ctx = canvas.getContext('2d');

    /* ---------------------------------------------------------------- 工具 */
    var TAU = Math.PI * 2;
    var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
    var lerp = function (a, b, t) { return a + (b - a) * t; };
    var easeOut = function (t) { return 1 - Math.pow(1 - t, 3); };
    var easeIn = function (t) { return t * t * t; };
    var easeInOut = function (t) { return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; };
    var sat = function (t) { return clamp(t, 0, 1); };
    function span(t, a, b) { return sat((t - a) / (b - a)); }

    function mulberry32(a) {
        return function () {
            a |= 0; a = a + 0x6D2B79F5 | 0;
            var t = Math.imul(a ^ a >>> 15, 1 | a);
            t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
            return ((t ^ t >>> 14) >>> 0) / 4294967296;
        };
    }
    var rng = mulberry32(20220205);
    function rr(a, b) { return a + rng() * (b - a); }

    /* --------------------------------------------------------------- 向量 */
    function V(x, y, z) { return { x: x, y: y, z: z }; }
    function vadd(a, b) { return V(a.x + b.x, a.y + b.y, a.z + b.z); }
    function vsub(a, b) { return V(a.x - b.x, a.y - b.y, a.z - b.z); }
    function vmul(a, s) { return V(a.x * s, a.y * s, a.z * s); }
    function vdot(a, b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
    function vcross(a, b) {
        return V(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x);
    }
    function vlen(a) { return Math.sqrt(vdot(a, a)); }
    function vnorm(a) { var l = vlen(a) || 1; return V(a.x / l, a.y / l, a.z / l); }
    function vlerp(a, b, t) { return V(lerp(a.x, b.x, t), lerp(a.y, b.y, t), lerp(a.z, b.z, t)); }
    function rotAxis(v, axis, ang) {
        var c = Math.cos(ang), s = Math.sin(ang), d = vdot(axis, v), cr = vcross(axis, v);
        return V(
            v.x * c + cr.x * s + axis.x * d * (1 - c),
            v.y * c + cr.y * s + axis.y * d * (1 - c),
            v.z * c + cr.z * s + axis.z * d * (1 - c)
        );
    }
    function perp(v) {
        var a = Math.abs(v.y) < 0.9 ? V(0, 1, 0) : V(1, 0, 0);
        return vnorm(vcross(v, a));
    }

    /* --------------------------------------------------------- 画质自适应 */
    var isMobile = Math.min(window.innerWidth, window.innerHeight) < 720 ||
        /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);

    var Q = {
        clouds: isMobile ? 9 : 16,
        petals: isMobile ? 90 : 170,
        motes: isMobile ? 14 : 28,
        blossoms: isMobile ? 120 : 240,
        dpr: isMobile ? 1.8 : 2
    };
    var supportsFilter = (function () {
        var c = document.createElement('canvas').getContext('2d');
        return typeof c.filter === 'string';
    })();

    /* ------------------------------------------------------------ 精灵图 */
    function makeGlow(color, size, core) {
        var c = document.createElement('canvas');
        c.width = c.height = size;
        var g = c.getContext('2d');
        var r = size / 2;
        var grd = g.createRadialGradient(r, r, 0, r, r, r);
        grd.addColorStop(0, 'rgba(255,255,255,' + (core === undefined ? 0.9 : core) + ')');
        grd.addColorStop(0.22, color.replace('%A%', '0.7'));
        grd.addColorStop(0.5, color.replace('%A%', '0.16'));
        grd.addColorStop(1, color.replace('%A%', '0'));
        g.fillStyle = grd;
        g.beginPath(); g.arc(r, r, r, 0, TAU); g.fill();
        return c;
    }
    // 蓬松的云：几团柔白叠在一起
    function makeCloud() {
        var S = 256, c = document.createElement('canvas');
        c.width = S; c.height = S * 0.66;
        var g = c.getContext('2d');
        var puffs = [
            [0.30, 0.62, 0.26], [0.50, 0.50, 0.34], [0.70, 0.60, 0.28],
            [0.42, 0.66, 0.22], [0.60, 0.68, 0.22], [0.50, 0.74, 0.30]
        ];
        for (var i = 0; i < puffs.length; i++) {
            var px = puffs[i][0] * S, py = puffs[i][1] * S * 0.66, pr = puffs[i][2] * S;
            var grd = g.createRadialGradient(px, py, 0, px, py, pr);
            grd.addColorStop(0, 'rgba(255,255,255,0.95)');
            grd.addColorStop(0.55, 'rgba(255,255,255,0.7)');
            grd.addColorStop(1, 'rgba(255,255,255,0)');
            g.fillStyle = grd;
            g.beginPath(); g.arc(px, py, pr, 0, TAU); g.fill();
        }
        return c;
    }
    function petalPath(g, r) {
        g.beginPath();
        g.moveTo(0, 0);
        g.bezierCurveTo(r * 0.62, -r * 0.42, r * 1.12, -r * 0.08, r * 1.2, r * 0.34);
        g.bezierCurveTo(r * 1.0, r * 0.82, r * 0.36, r * 0.94, 0, r * 0.5);
        g.bezierCurveTo(-r * 0.3, r * 0.22, -r * 0.24, -r * 0.12, 0, 0);
        g.closePath();
    }
    function makePetal(c1, c2, glow) {
        var S = 72, c = document.createElement('canvas');
        c.width = c.height = S;
        var g = c.getContext('2d');
        g.translate(S / 2, S / 2);
        var r = S * 0.3;
        g.save();
        g.shadowColor = glow; g.shadowBlur = S * 0.22;
        g.fillStyle = c1; petalPath(g, r); g.fill();
        g.restore();
        var grd = g.createLinearGradient(-r * 0.2, -r * 0.4, r * 1.1, r * 0.9);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.4, c1);
        grd.addColorStop(1, c2);
        g.fillStyle = grd; petalPath(g, r); g.fill();
        return c;
    }

    var SPR = {
        sun: makeGlow('rgba(255,236,170,%A%)', 128),
        pink: makeGlow('rgba(255,168,200,%A%)', 96),
        ice: makeGlow('rgba(210,236,255,%A%)', 96),
        white: makeGlow('rgba(255,252,246,%A%)', 96),
        green: makeGlow('rgba(170,224,150,%A%)', 96),
        cloud: makeCloud(),
        // 花瓣（前两种为樱花粉/白，第三种为嫩绿叶）
        petals: [
            makePetal('#ffe1ec', '#ffb0cf', 'rgba(255,160,200,0.8)'),
            makePetal('#fff6fb', '#ffd6e6', 'rgba(255,190,214,0.8)'),
            makePetal('#c7ebac', '#93cf77', 'rgba(150,205,120,0.8)')
        ],
        // 飘落的花瓣：粉、白两色
        fall: [
            makePetal('#ffe1ec', '#ffb0cf', 'rgba(255,160,200,0.8)'),
            makePetal('#fff6fb', '#ffd6e6', 'rgba(255,190,214,0.8)')
        ]
    };

    var bloomC = document.createElement('canvas');
    var bloomG = bloomC.getContext('2d');

    /* ------------------------------------------------------------- 相机 */
    var W = 0, H = 0, DPR = 1, cx = 0, cy = 0, focal = 800;
    var cam = {
        pos: V(0, 8, 34), tgt: V(0, 8, 0), fov: 44,
        dpos: V(0, 8, 34), dtgt: V(0, 8, 0), dfov: 44
    };
    var basis = { r: V(1, 0, 0), u: V(0, 1, 0), f: V(0, 0, -1) };

    function resize() {
        DPR = Math.min(window.devicePixelRatio || 1, Q.dpr);
        W = window.innerWidth; H = window.innerHeight;
        canvas.width = Math.floor(W * DPR);
        canvas.height = Math.floor(H * DPR);
        canvas.style.width = W + 'px';
        canvas.style.height = H + 'px';
        bloomC.width = Math.max(2, Math.floor(canvas.width / 4));
        bloomC.height = Math.max(2, Math.floor(canvas.height / 4));
        cx = canvas.width / 2; cy = canvas.height / 2;
    }
    window.addEventListener('resize', resize);
    resize();

    function updateBasis() {
        basis.f = vnorm(vsub(cam.tgt, cam.pos));
        basis.r = vnorm(vcross(basis.f, V(0, 1, 0)));
        basis.u = vcross(basis.r, basis.f);
        focal = 0.5 * canvas.height / Math.tan(cam.fov * Math.PI / 360);
    }

    function proj(p) {
        var dx = p.x - cam.pos.x, dy = p.y - cam.pos.y, dz = p.z - cam.pos.z;
        var ez = dx * basis.f.x + dy * basis.f.y + dz * basis.f.z;
        if (ez < 0.12) return null;
        var ex = dx * basis.r.x + dy * basis.r.y + dz * basis.r.z;
        var ey = dx * basis.u.x + dy * basis.u.y + dz * basis.u.z;
        var s = focal / ez;
        return { x: cx + ex * s, y: cy - ey * s, s: s, z: ez };
    }

    /* ------------------------------------------------------ 程序化 3D 树 */
    var branches = [];
    var blossoms = [];

    (function buildTree() {
        function branch(origin, dir, len, rad, depth, t0, dur) {
            var segs = depth === 0 ? 15 : Math.max(5, 11 - depth * 2);
            var nodes = [];
            var p = origin, d = vnorm(dir);
            var side = perp(d);
            var curl = rr(-1, 1), spiral = rr(-0.4, 0.4);
            for (var i = 0; i <= segs; i++) {
                var f = i / segs;
                nodes.push({ p: p, r: rad * (1 - f * 0.8) });
                var bendUp = (depth === 0 ? 0.02 : 0.05) * (1 - f * 0.4);
                d = vnorm(vadd(d, vadd(vmul(V(0, 1, 0), bendUp), vmul(side, curl * 0.03))));
                side = vnorm(vadd(side, vmul(vcross(d, side), spiral * 0.05)));
                p = vadd(p, vmul(d, len / segs));
            }
            var b = {
                nodes: nodes, depth: depth, t0: t0, dur: dur,
                tip: p, sway: rr(0, TAU), swayAmp: 0.02 + depth * 0.05
            };
            branches.push(b);

            if (depth >= 4) {
                for (var k = 0; k < 3; k++) {
                    addBlossom(nodes[Math.max(0, nodes.length - 1 - k * 2)].p, t0 + dur, b);
                }
                return;
            }
            var kids = depth === 0 ? 4 : (depth === 1 ? 3 : (rng() < 0.7 ? 3 : 2));
            var baseRoll = rr(0, TAU);
            for (var c = 0; c < kids; c++) {
                var at = depth === 0 ? lerp(0.44, 0.99, c / Math.max(1, kids - 1)) : lerp(0.45, 1.0, rng());
                var idx = clamp(Math.round(at * segs), 1, segs);
                var node = nodes[idx];
                var axis = rotAxis(perp(d), vnorm(d), baseRoll + c * (TAU / kids) + rr(-0.4, 0.4));
                var ang = depth === 0 ? rr(0.42, 0.7) : rr(0.36, 0.8);
                var nd = rotAxis(vnorm(vsub(nodes[idx].p, nodes[idx - 1].p)), axis, ang);
                nd = vnorm(vadd(nd, V(0, 0.22, 0)));
                branch(node.p, nd, len * rr(0.56, 0.72), Math.max(0.012, node.r * rr(0.52, 0.66)),
                    depth + 1, t0 + dur * (idx / segs) * 0.9, dur * rr(0.55, 0.72));
                if (depth >= 2 && rng() < 0.45) addBlossom(node.p, t0 + dur, b);
            }
        }
        function addBlossom(p, t, b) {
            if (blossoms.length >= Q.blossoms) return;
            blossoms.push({
                p: V(p.x + rr(-0.15, 0.15), p.y + rr(-0.15, 0.15), p.z + rr(-0.15, 0.15)),
                t0: t + rr(0.2, 3.0), size: rr(0.15, 0.32), spin: rr(0, TAU),
                tone: (rng() * 10) | 0, twk: rr(0, TAU), host: b
            });
        }
        branch(V(0, 0, 0), V(rr(-0.05, 0.05), 1, rr(-0.05, 0.05)), 7.0, 0.42, 0, 0, 2.8);
    })();

    function windOffset(b, i, t) {
        var f = i / (b.nodes.length - 1);
        var a = Math.sin(t * 0.6 + b.sway) * 0.6 + Math.sin(t * 1.3 + b.sway * 1.7) * 0.2;
        var amp = b.swayAmp * f * f;
        return V(a * amp, 0, Math.cos(t * 0.5 + b.sway) * amp * 0.6);
    }

    /* ------------------------------------------------------------ 粒子 */
    // 白云：高空飘浮，缓缓向右移动
    var clouds = [];
    for (var i = 0; i < Q.clouds; i++) {
        clouds.push({
            p: V(rr(-80, 80), rr(20, 52), rr(-105, -48)),
            s: rr(8, 17), sp: rr(0.25, 0.7), a: rr(0.4, 0.72)
        });
    }

    var petals = [];
    function resetPetal(pt, first) {
        pt.p = V(rr(-14, 14), first ? rr(2, 20) : rr(14, 22), rr(-12, 10));
        pt.vy = -rr(0.45, 1.1);
        pt.sw = rr(0, TAU); pt.swSp = rr(0.4, 1.1); pt.swAmp = rr(0.4, 1.4);
        pt.spin = rr(0, TAU); pt.spinSp = rr(-1.6, 1.6);
        pt.flip = rr(0, TAU); pt.flipSp = rr(0.5, 2.0);
        pt.size = rr(0.09, 0.22);
        pt.spr = SPR.fall[(rng() * SPR.fall.length) | 0];
        return pt;
    }
    for (var i2 = 0; i2 < Q.petals; i2++) petals.push(resetPetal({}, true));

    // 阳光下的浮尘 / 花粉，缓缓上浮
    var motes = [];
    for (var i3 = 0; i3 < Q.motes; i3++) {
        motes.push({
            p: V(rr(-12, 12), rr(1, 14), rr(-10, 8)),
            vy: rr(0.15, 0.5), sw: rr(0, TAU), swSp: rr(0.2, 0.6), swAmp: rr(0.3, 1.0),
            r: rr(1.0, 2.6), tw: rr(0, TAU), spr: rng() < 0.4 ? SPR.white : SPR.sun, a: rr(0.2, 0.5)
        });
    }

    /* --------------------------------------------------------- 相机编排 */
    var ACT = { fall: 0.0, land: 2.6, grow: 2.8, text: 9.6, clock: 11.6 };
    var GROW_SPAN = 7.6;
    var started = false, T = 0, last = 0;
    var sun = V(24, 33, -30);          // 暖阳在右上方，避开左侧情书

    function cameraDirector(t, dt) {
        var P, Tg, fov = 44;
        var slow = t * 0.05;
        if (!started) {
            P = V(Math.sin(slow) * 30, 9 + Math.sin(t * 0.2) * 0.5, Math.cos(slow) * 30);
            Tg = V(0, 9.5, 0);
        } else if (t < ACT.land) {
            var k = span(t, 0, ACT.land);
            P = V(lerp(6, 4, easeInOut(k)), lerp(11, 7, easeInOut(k)), lerp(30, 24, easeInOut(k)));
            Tg = V(0, lerp(12.5, 2, easeIn(k)), 0);
        } else if (t < ACT.grow + GROW_SPAN) {
            var g = span(t, ACT.land, ACT.grow + GROW_SPAN);
            var ang = -0.25 + g * 0.8;
            var rad = lerp(17, 26, easeOut(g));
            P = V(Math.sin(ang) * rad, lerp(2.4, 12, easeInOut(g)), Math.cos(ang) * rad);
            Tg = V(0, lerp(2, 9.5, easeOut(g)), 0);
            fov = lerp(50, 44, g);
        } else {
            var f = t - (ACT.grow + GROW_SPAN);
            var ang2 = 0.55 + f * 0.035;               // 极缓的环绕
            var rad2 = 27 + Math.sin(f * 0.1) * 2.5;
            P = V(Math.sin(ang2) * rad2, 10.5 + Math.sin(f * 0.13) * 1.4, Math.cos(ang2) * rad2);
            Tg = V(0, 9 + Math.sin(f * 0.08) * 0.7, 0);
        }
        // 平滑（临界阻尼），无手持抖动
        var k1 = 1 - Math.pow(0.0009, dt);
        cam.dpos = vlerp(cam.dpos, P, k1);
        cam.dtgt = vlerp(cam.dtgt, Tg, k1);
        cam.dfov = lerp(cam.dfov, fov, k1);
        cam.pos = cam.dpos; cam.tgt = cam.dtgt; cam.fov = cam.dfov;
        updateBasis();
    }

    /* ------------------------------------------------------------ 绘制 */
    function drawSprite(spr, sx, sy, size, alpha) {
        if (alpha <= 0.004 || size <= 0.2) return;
        if (sx < -size || sx > canvas.width + size || sy < -size || sy > canvas.height + size) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(spr, sx - size / 2, sy - size / 2, size, size);
    }
    function drawSpriteWH(spr, sx, sy, w, h, alpha) {
        if (alpha <= 0.004 || w <= 0.2) return;
        if (sx < -w || sx > canvas.width + w || sy < -h || sy > canvas.height + h) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(spr, sx - w / 2, sy - h / 2, w, h);
    }
    function horizonY() {
        var hd = vnorm(V(basis.f.x, 0, basis.f.z));
        var ez = vdot(hd, basis.f), ey = vdot(hd, basis.u);
        if (ez <= 0.001) return cy;
        return cy - focal * (ey / ez);
    }

    // 明净蓝天渐变（顶部湛蓝 → 地平线附近的暖白）
    function drawSky(t) {
        var grd = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grd.addColorStop(0.00, '#5fb4f2');
        grd.addColorStop(0.34, '#8fcdf6');
        grd.addColorStop(0.62, '#c4e6fb');
        grd.addColorStop(0.82, '#eaf6ff');
        grd.addColorStop(1.00, '#fdf1ec');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    // 暖阳：柔和外晕 + 明亮内核 + 缓缓旋转的光芒
    function drawSun(t) {
        var q = proj(sun);
        if (!q) return;
        ctx.globalCompositeOperation = 'lighter';
        // 光芒
        ctx.save();
        ctx.translate(q.x, q.y);
        ctx.rotate(t * 0.03);
        var rays = 12, len = 190 * DPR, inr = 60 * DPR;
        ctx.strokeStyle = 'rgba(255,240,190,0.16)';
        ctx.lineWidth = 8 * DPR;
        ctx.lineCap = 'round';
        for (var i = 0; i < rays; i++) {
            var a = i / rays * TAU;
            var wob = 1 + 0.12 * Math.sin(t * 1.3 + i);
            ctx.beginPath();
            ctx.moveTo(Math.cos(a) * inr, Math.sin(a) * inr);
            ctx.lineTo(Math.cos(a) * len * wob, Math.sin(a) * len * wob);
            ctx.stroke();
        }
        ctx.restore();
        // 光晕 + 内核
        drawSprite(SPR.sun, q.x, q.y, 640 * DPR, 0.30);
        drawSprite(SPR.sun, q.x, q.y, 300 * DPR, 0.40);
        drawSprite(SPR.white, q.x, q.y, 150 * DPR, 0.75);
        drawSprite(SPR.white, q.x, q.y, 78 * DPR, 0.9);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    // 雨后彩虹：随树的生长柔柔浮现，横跨天际
    function drawRainbow(t) {
        var gate = span(T, ACT.grow + 1.5, ACT.grow + 6);
        if (gate <= 0) return;
        var cxp = canvas.width * 0.5 + Math.sin(t * 0.05) * canvas.width * 0.02;
        var cyp = canvas.height * 1.02;
        var R = Math.max(canvas.width, canvas.height) * 0.72;
        var bands = [
            'rgba(255,140,150,', 'rgba(255,190,120,', 'rgba(255,238,150,',
            'rgba(160,225,150,', 'rgba(140,205,255,', 'rgba(160,170,255,', 'rgba(205,155,240,'
        ];
        var bw = R * 0.026;
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < bands.length; i++) {
            ctx.beginPath();
            ctx.lineWidth = bw;
            ctx.strokeStyle = bands[i] + (0.16 * gate).toFixed(3) + ')';
            ctx.arc(cxp, cyp, R - i * bw, Math.PI, TAU);
            ctx.stroke();
        }
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawClouds(t, dt) {
        for (var i = 0; i < clouds.length; i++) {
            var c = clouds[i];
            c.p.x += c.sp * dt;
            if (c.p.x > 82) { c.p.x = -82; c.p.z = rr(-105, -48); c.p.y = rr(20, 52); }
            var q = proj(c.p);
            if (!q) continue;
            var w = c.s * q.s * 1.6, h = w * 0.6;
            drawSpriteWH(SPR.cloud, q.x, q.y, w, h, c.a);
        }
        ctx.globalAlpha = 1;
    }

    function drawGround(t) {
        var hy = horizonY();
        if (hy > -canvas.height) {
            var top = Math.max(hy, -10);
            var grd = ctx.createLinearGradient(0, top, 0, canvas.height);
            grd.addColorStop(0, 'rgba(197,231,168,0)');
            grd.addColorStop(0.12, 'rgba(178,220,150,0.75)');
            grd.addColorStop(0.55, 'rgba(140,196,120,0.95)');
            grd.addColorStop(1, 'rgba(108,172,96,1)');
            ctx.fillStyle = grd;
            ctx.fillRect(0, top, canvas.width, canvas.height - top);
        }
        // 树根处的暖光池
        var base = proj(V(0, 0.02, 0));
        if (base) {
            var r = 180 * base.s / 30 * DPR + 40 * DPR;
            var pg = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, r);
            pg.addColorStop(0, 'rgba(255,244,200,0.35)');
            pg.addColorStop(0.5, 'rgba(200,230,150,0.12)');
            pg.addColorStop(1, 'rgba(150,200,120,0)');
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = pg;
            ctx.beginPath(); ctx.ellipse(base.x, base.y, r, r * 0.3, 0, 0, TAU); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    function drawTree(t) {
        var growT = T - ACT.grow;
        var sn = proj(sun);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (var i = 0; i < branches.length; i++) {
            var b = branches[i];
            var p = sat((growT - b.t0) / b.dur);
            if (p <= 0) continue;
            var trunkCol = b.depth <= 1 ? '#7a4a2c' : (b.depth === 2 ? '#8a5a33' : '#98663c');
            var n = b.nodes.length;
            var upto = p * (n - 1);
            var count = Math.floor(upto);
            var frac = upto - count;
            var prev = null, prevR = 0;
            for (var j = 0; j <= count; j++) {
                var wp = vadd(b.nodes[j].p, windOffset(b, j, t));
                var q = proj(wp);
                var rad = b.nodes[j].r;
                if (prev && q) {
                    var lw = Math.max(0.6 * DPR, (rad + prevR) * 0.5 * q.s);
                    ctx.strokeStyle = trunkCol;
                    ctx.lineWidth = lw;
                    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke();
                    if (lw > 1.1 * DPR) {
                        var ox = 0, oy = -lw * 0.24;
                        if (sn) {
                            var ldx = sn.x - q.x, ldy = sn.y - q.y, ll = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
                            ox = ldx / ll * lw * 0.24; oy = ldy / ll * lw * 0.24;
                        }
                        ctx.strokeStyle = 'rgba(255,236,190,0.4)';
                        ctx.lineWidth = lw * 0.42;
                        ctx.beginPath(); ctx.moveTo(prev.x + ox, prev.y + oy); ctx.lineTo(q.x + ox, q.y + oy); ctx.stroke();
                    }
                }
                prev = q; prevR = rad;
            }
            if (count < n - 1 && prev) {
                var a1 = b.nodes[count].p, a2 = b.nodes[count + 1].p;
                var mp = vadd(vlerp(a1, a2, frac), windOffset(b, count + frac, t));
                var q2 = proj(mp);
                if (q2) {
                    ctx.strokeStyle = trunkCol;
                    ctx.lineWidth = Math.max(0.6 * DPR, b.nodes[count].r * q2.s);
                    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawBlossoms(t) {
        var growT = T - ACT.grow;
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < blossoms.length; i++) {
            var f = blossoms[i];
            var age = growT - f.t0;
            if (age <= 0) continue;
            var pop = sat(age / 1.1);
            var sc = easeOut(pop) * (1 + 0.1 * Math.sin(t * 1.2 + f.twk));
            var q = proj(vadd(f.p, windOffset(f.host, f.host.nodes.length - 1, t)));
            if (!q) continue;
            var size = f.size * q.s * sc;
            var al = 0.7 + 0.3 * Math.sin(t * 1.5 + f.twk);
            var isLeaf = f.tone % 3 === 2;
            drawSprite(isLeaf ? SPR.green : SPR.pink, q.x, q.y, size * 7, al * 0.35);
            var spr = SPR.petals[f.tone % SPR.petals.length];
            ctx.save();
            ctx.translate(q.x, q.y);
            ctx.rotate(f.spin + t * 0.08);
            var leaves = isLeaf ? 2 : 5;
            for (var k = 0; k < leaves; k++) {
                ctx.rotate(TAU / leaves);
                ctx.globalAlpha = al * 0.9;
                ctx.drawImage(spr, size * 0.15, -size * 0.85, size * 1.7, size * 1.7);
            }
            ctx.restore();
            if (pop < 1) drawSprite(SPR.white, q.x, q.y, size * 12 * (1 - pop), (1 - pop) * 0.35);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function updatePetals(t, dt) {
        for (var i = 0; i < petals.length; i++) {
            var p = petals[i];
            p.sw += p.swSp * dt; p.spin += p.spinSp * dt; p.flip += p.flipSp * dt;
            p.p.y += p.vy * dt;
            p.p.x += Math.sin(p.sw) * p.swAmp * dt;
            p.p.z += Math.cos(p.sw * 0.8) * p.swAmp * 0.5 * dt;
            if (p.p.y < -1.2) resetPetal(p, false);
        }
    }
    function drawPetals(t) {
        var petalStart = ACT.grow + 5;
        if (T < petalStart) return;
        var gate = sat((T - petalStart) / 4);
        for (var i = 0; i < petals.length; i++) {
            var p = petals[i];
            if (i / petals.length > gate) continue;
            var q = proj(p.p);
            if (!q) continue;
            var size = p.size * q.s * 2.0;
            var squash = Math.abs(Math.cos(p.flip)) * 0.75 + 0.25;
            ctx.save();
            ctx.translate(q.x, q.y);
            ctx.rotate(p.spin);
            ctx.scale(1, squash);
            ctx.globalAlpha = 0.92;
            ctx.drawImage(p.spr, -size / 2, -size / 2, size, size);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }

    function drawMotes(t, dt) {
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < motes.length; i++) {
            var m = motes[i];
            m.p.y += m.vy * dt; m.sw += m.swSp * dt;
            m.p.x += Math.sin(m.sw) * m.swAmp * dt;
            if (m.p.y > 15) { m.p.y = 0.5; m.p.x = rr(-12, 12); m.p.z = rr(-10, 8); }
            var q = proj(m.p);
            if (!q) continue;
            var tw = 0.5 + 0.5 * Math.sin(t * 1.2 + m.tw);
            drawSprite(m.spr, q.x, q.y, m.r * q.s * 0.7, m.a * tw * 0.7);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    // 一颗柔光种子缓缓落下（无闪白、无抖动）
    function drawSeed(t) {
        if (T > ACT.land + 0.3) return;
        var y = started ? lerp(12.5, 0.1, easeInOut(span(T, 0, ACT.land))) : 12.5 + Math.sin(t * 0.8) * 0.4;
        var q = proj(V(0, y, 0));
        if (!q) return;
        ctx.globalCompositeOperation = 'lighter';
        var pulse = 0.8 + 0.2 * Math.sin(t * 2.0);
        drawSprite(SPR.sun, q.x, q.y, 190 * DPR * pulse, 0.4);
        drawSprite(SPR.pink, q.x, q.y, 96 * DPR * pulse, 0.45);
        drawSprite(SPR.white, q.x, q.y, 34 * DPR, 0.9);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    /* ------------------------------------------------------------ 后期 */
    function postFX() {
        // 轻柔泛光
        if (supportsFilter) {
            bloomG.globalCompositeOperation = 'source-over';
            bloomG.clearRect(0, 0, bloomC.width, bloomC.height);
            bloomG.filter = 'blur(' + (2.4 * DPR).toFixed(1) + 'px) brightness(1.05)';
            bloomG.drawImage(canvas, 0, 0, bloomC.width, bloomC.height);
            bloomG.filter = 'none';
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.13;
            ctx.drawImage(bloomC, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }
        // 极淡的暖色暗角，收一点边缘
        var vg = ctx.createRadialGradient(cx, cy * 0.9, Math.min(cx, cy) * 0.6,
            cx, cy, Math.max(cx, cy) * 1.15);
        vg.addColorStop(0, 'rgba(255,255,255,0)');
        vg.addColorStop(0.82, 'rgba(255,238,210,0.05)');
        vg.addColorStop(1, 'rgba(120,150,110,0.16)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalAlpha = 1;
    }

    /* --------------------------------------------------------- 文字编排 */
    var textDone = false, clockDone = false;
    function revealText() {
        if (textDone) return;
        textDone = true;
        var code = document.getElementById('code');
        if (!code) return;
        code.style.display = 'block';
        var lines = code.querySelectorAll('.line');
        for (var i = 0; i < lines.length; i++) {
            (function (el, i) {
                setTimeout(function () { el.className += ' in'; }, i * 1000);
            })(lines[i], i);
        }
    }
    function revealClock() {
        if (clockDone) return;
        clockDone = true;
        var box = document.getElementById('clock-box');
        if (box) box.className += ' show';
        if (window.config && typeof timeElapse === 'function') {
            var d = new Date(String(window.config.date).replace(/-/g, '/').replace('T', ' '));
            if (isNaN(d.getTime())) d = new Date(window.config.date);
            timeElapse(d);
            setInterval(function () { timeElapse(d); }, 1000);
        }
    }

    /* -------------------------------------------------------------- 主帧 */
    function frame(now) {
        var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
        last = now;
        var t = now / 1000;
        if (started) T += dt;

        if (W !== window.innerWidth || H !== window.innerHeight) {
            if (window.innerWidth > 0 && window.innerHeight > 0) resize();
        }

        if (started && T >= ACT.text) revealText();
        if (started && T >= ACT.clock) revealClock();

        cameraDirector(T, dt);
        updatePetals(t, dt);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawSky(t);
        drawSun(t);
        drawRainbow(t);
        drawClouds(t, dt);
        drawGround(t);
        drawTree(t);
        drawBlossoms(t);
        drawMotes(t, dt);
        drawPetals(t);
        drawSeed(t);
        postFX();

        requestAnimationFrame(frame);
    }

    /* -------------------------------------------------------------- 交互 */
    document.body.className += ' await';
    function start() {
        if (started) return;
        started = true;
        T = 0;
        document.body.className = document.body.className.replace(' await', '') + ' playing';
        try {
            var m = document.querySelector('.song-audio-autoplay');
            var btn = document.getElementById('music-btn');
            if (m && m.paused) {
                var pr = m.play();
                if (pr && pr.then) pr.then(function () { if (btn) btn.className = 'rotateImages'; }).catch(function () { });
                else if (btn) btn.className = 'rotateImages';
            }
        } catch (e) { }
    }
    window.addEventListener('pointerdown', function (e) {
        if (e.target && e.target.id === 'music-btn') return;
        start();
    });
    window.addEventListener('keydown', function (e) {
        if (e.key === ' ' || e.key === 'Enter') start();
    });

    requestAnimationFrame(frame);
})();
