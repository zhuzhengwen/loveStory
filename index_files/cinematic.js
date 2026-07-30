/* ============================================================================
 *  Cinematic Love Story — 一个纯 Canvas 的 3D 电影级渲染引擎
 *  · 透视相机 / 深度排序 / 景深散景 / 泛光 / 体积光 / 水面倒影 / 胶片颗粒
 *  · 三幕分镜：星尘落种 → 生命之树 → 花开成心
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
    // 区间映射 + 平滑
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
    var isSmall = Math.min(window.innerWidth, window.innerHeight) < 720;
    var isMobile = isSmall || /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
    var lowPower = isMobile || (navigator.hardwareConcurrency || 4) <= 4;

    var Q = {
        stars: isMobile ? 460 : 1100,
        petals: isMobile ? 190 : 460,
        embers: isMobile ? 70 : 170,
        flies: isMobile ? 28 : 66,
        blossoms: isMobile ? 130 : 300,
        rays: isMobile ? 7 : 11,
        bloom: true,
        reflect: true,
        grain: true,
        dpr: isMobile ? 1.8 : 2
    };
    var supportsFilter = (function () {
        var c = document.createElement('canvas').getContext('2d');
        return typeof c.filter === 'string';
    })();
    if (!supportsFilter) Q.bloom = false;

    /* ------------------------------------------------------------ 精灵图 */
    function makeGlow(color, size, core) {
        var c = document.createElement('canvas');
        c.width = c.height = size;
        var g = c.getContext('2d');
        var r = size / 2;
        var grd = g.createRadialGradient(r, r, 0, r, r, r);
        grd.addColorStop(0, 'rgba(255,255,255,' + (core === undefined ? 0.95 : core) + ')');
        grd.addColorStop(0.18, color.replace('%A%', '0.85'));
        grd.addColorStop(0.45, color.replace('%A%', '0.22'));
        grd.addColorStop(1, color.replace('%A%', '0'));
        g.fillStyle = grd;
        g.beginPath(); g.arc(r, r, r, 0, TAU); g.fill();
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
    function makePetal(c1, c2, glowColor) {
        var S = 72, c = document.createElement('canvas');
        c.width = c.height = S;
        var g = c.getContext('2d');
        g.translate(S / 2, S / 2);
        var r = S * 0.3;
        // 外发光
        g.save();
        g.shadowColor = glowColor; g.shadowBlur = S * 0.28;
        g.fillStyle = c1; petalPath(g, r); g.fill(); g.fill();
        g.restore();
        // 渐变本体
        var grd = g.createLinearGradient(-r * 0.2, -r * 0.4, r * 1.1, r * 0.9);
        grd.addColorStop(0, '#ffffff');
        grd.addColorStop(0.35, c1);
        grd.addColorStop(1, c2);
        g.fillStyle = grd; petalPath(g, r); g.fill();
        // 高光脉络
        g.strokeStyle = 'rgba(255,255,255,0.55)';
        g.lineWidth = 0.8;
        g.beginPath(); g.moveTo(r * 0.05, r * 0.08);
        g.quadraticCurveTo(r * 0.5, r * 0.22, r * 1.02, r * 0.3); g.stroke();
        return c;
    }

    var SPR = {
        warm: makeGlow('rgba(255,196,110,%A%)', 96),
        pink: makeGlow('rgba(255,132,186,%A%)', 96),
        rose: makeGlow('rgba(255,86,140,%A%)', 96),
        ice: makeGlow('rgba(168,206,255,%A%)', 96),
        violet: makeGlow('rgba(178,132,255,%A%)', 96),
        white: makeGlow('rgba(255,244,250,%A%)', 96),
        petals: [
            makePetal('#ffd7e6', '#ff8fb8', 'rgba(255,140,190,0.9)'),
            makePetal('#fff0f5', '#ffb3cd', 'rgba(255,180,210,0.9)'),
            makePetal('#ffe9c9', '#ffb97a', 'rgba(255,190,120,0.9)'),
            makePetal('#f6e2ff', '#d3a0ff', 'rgba(210,150,255,0.9)')
        ]
    };

    /* ---------------------------------------------------------- 星云背景 */
    var nebula = (function () {
        var S = 1024, c = document.createElement('canvas');
        c.width = c.height = S;
        var g = c.getContext('2d');
        g.fillStyle = '#04030d';
        g.fillRect(0, 0, S, S);
        function cloud(x, y, r, col, a) {
            var grd = g.createRadialGradient(x, y, 0, x, y, r);
            grd.addColorStop(0, col.replace('%A%', a));
            grd.addColorStop(0.5, col.replace('%A%', a * 0.35));
            grd.addColorStop(1, col.replace('%A%', '0'));
            g.fillStyle = grd;
            g.beginPath(); g.arc(x, y, r, 0, TAU); g.fill();
        }
        g.globalCompositeOperation = 'lighter';
        var palette = [
            'rgba(92,44,158,%A%)', 'rgba(28,58,150,%A%)', 'rgba(178,42,110,%A%)',
            'rgba(14,86,132,%A%)', 'rgba(120,30,60,%A%)', 'rgba(60,20,120,%A%)'
        ];
        for (var i = 0; i < 46; i++) {
            cloud(rr(0, S), rr(0, S), rr(120, 460), palette[(rng() * palette.length) | 0], rr(0.05, 0.2));
        }
        // 远景星尘
        for (var j = 0; j < 1600; j++) {
            var x = rr(0, S), y = rr(0, S), rad = rr(0.3, 1.5);
            g.fillStyle = 'rgba(255,255,255,' + rr(0.15, 0.7) + ')';
            g.beginPath(); g.arc(x, y, rad, 0, TAU); g.fill();
        }
        g.globalCompositeOperation = 'source-over';
        return c;
    })();

    /* ----------------------------------------------------------- 颗粒噪点 */
    var grainTile = (function () {
        var S = 180, c = document.createElement('canvas');
        c.width = c.height = S;
        var g = c.getContext('2d');
        var img = g.createImageData(S, S);
        for (var i = 0; i < img.data.length; i += 4) {
            var v = 118 + (Math.random() * 74) | 0;
            img.data[i] = img.data[i + 1] = img.data[i + 2] = v;
            img.data[i + 3] = 255;
        }
        g.putImageData(img, 0, 0);
        return c;
    })();
    var grainPat = ctx.createPattern(grainTile, 'repeat');

    var bloomC = document.createElement('canvas');
    var bloomG = bloomC.getContext('2d');

    /* ------------------------------------------------------------- 相机 */
    var W = 0, H = 0, DPR = 1, cx = 0, cy = 0, focal = 800;
    var cam = {
        pos: V(0, 7, 34), tgt: V(0, 7, 0), fov: 46, roll: 0,
        // 平滑到目标
        dpos: V(0, 7, 34), dtgt: V(0, 7, 0), dfov: 46, droll: 0
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

    var rollC = 1, rollS = 0;
    // 投影：返回 {x,y,s,z}，s 为屏幕缩放系数；mirror 为水面倒影
    function proj(p, mirror) {
        var dx = p.x - cam.pos.x,
            dy = (mirror ? -p.y : p.y) - cam.pos.y,
            dz = p.z - cam.pos.z;
        var ez = dx * basis.f.x + dy * basis.f.y + dz * basis.f.z;
        if (ez < 0.12) return null;
        var ex = dx * basis.r.x + dy * basis.r.y + dz * basis.r.z;
        var ey = dx * basis.u.x + dy * basis.u.y + dz * basis.u.z;
        var rx = ex * rollC - ey * rollS;
        var ry = ex * rollS + ey * rollC;
        var s = focal / ez;
        return { x: cx + rx * s, y: cy - ry * s, s: s, z: ez };
    }

    /* ------------------------------------------------------ 程序化 3D 树 */
    var branches = [];
    var blossoms = [];

    (function buildTree() {
        var GROW_T0 = 0;
        function branch(origin, dir, len, rad, depth, t0, dur) {
            var segs = depth === 0 ? 16 : Math.max(5, 12 - depth * 2);
            var nodes = [];
            var p = origin, d = vnorm(dir);
            var side = perp(d);
            var curl = rr(-1, 1), spiral = rr(-0.5, 0.5);
            for (var i = 0; i <= segs; i++) {
                var f = i / segs;
                nodes.push({ p: p, r: rad * (1 - f * 0.82) * (depth === 0 ? (1 - f * 0.15) : 1) });
                // 弯曲：向上抬 + 侧向摆 + 轻微螺旋
                var up = V(0, 1, 0);
                var bendUp = (depth === 0 ? 0.02 : 0.055) * (1 - f * 0.4);
                d = vnorm(vadd(d, vadd(vmul(up, bendUp), vmul(side, curl * 0.035))));
                side = vnorm(vadd(side, vmul(vcross(d, side), spiral * 0.06)));
                p = vadd(p, vmul(d, len / segs));
            }
            var b = {
                nodes: nodes, depth: depth, t0: t0, dur: dur,
                tip: p, dir: d, sway: rr(0, TAU), swayAmp: 0.02 + depth * 0.055
            };
            branches.push(b);

            if (depth >= 4) {
                // 末梢挂花
                for (var k = 0; k < 3; k++) {
                    addBlossom(nodes[Math.min(nodes.length - 1, nodes.length - 1 - k * 2)].p, t0 + dur, b);
                }
                return;
            }
            var kids = depth === 0 ? 4 : (depth === 1 ? 3 : (rng() < 0.72 ? 3 : 2));
            var baseRoll = rr(0, TAU);
            for (var c = 0; c < kids; c++) {
                var at = depth === 0 ? lerp(0.42, 0.99, c / Math.max(1, kids - 1)) : lerp(0.45, 1.0, rng());
                var idx = clamp(Math.round(at * segs), 1, segs);
                var node = nodes[idx];
                var axis = perp(d);
                axis = rotAxis(axis, vnorm(d), baseRoll + c * (TAU / kids) + rr(-0.4, 0.4));
                var ang = (depth === 0 ? rr(0.42, 0.72) : rr(0.36, 0.82));
                var nd = rotAxis(vnorm(vsub(nodes[idx].p, nodes[idx - 1].p)), axis, ang);
                nd = vnorm(vadd(nd, V(0, 0.22, 0)));
                var nlen = len * rr(0.56, 0.74) * (depth === 0 ? 0.95 : 1);
                var nrad = Math.max(0.012, node.r * rr(0.52, 0.68));
                var ct0 = t0 + dur * (idx / segs) * 0.92;
                branch(node.p, nd, nlen, nrad, depth + 1, ct0, dur * rr(0.55, 0.72));
                // 枝干中段也开花
                if (depth >= 2 && rng() < 0.5) addBlossom(node.p, ct0 + 0.4, b);
            }
        }

        function addBlossom(p, t, b) {
            if (blossoms.length >= Q.blossoms) return;
            blossoms.push({
                p: V(p.x + rr(-0.16, 0.16), p.y + rr(-0.16, 0.16), p.z + rr(-0.16, 0.16)),
                t0: t + rr(0.1, 2.6),
                size: rr(0.16, 0.34),
                spin: rr(0, TAU),
                tone: (rng() * 10) | 0,
                twk: rr(0, TAU),
                host: b
            });
        }

        branch(V(0, 0, 0), V(rr(-0.06, 0.06), 1, rr(-0.06, 0.06)), 7.2, 0.44, 0, GROW_T0, 2.6);
    })();

    // 树的世界坐标随风摆动（对每个分支施加一个绕基点的微小旋转）
    function windOffset(b, i, t) {
        var f = i / (b.nodes.length - 1);
        var a = Math.sin(t * 0.85 + b.sway) * 0.5 + Math.sin(t * 1.9 + b.sway * 1.7) * 0.25;
        var amp = b.swayAmp * f * f;
        return V(a * amp, 0, Math.cos(t * 0.7 + b.sway) * amp * 0.7);
    }

    /* -------------------------------------------------------- 心形靶点 */
    var heartPts = (function () {
        // 经典心形曲线 → 多边形轮廓 → 内部采样 → 双面拱起成 3D
        var out = [], n = 260;
        for (var i = 0; i < n; i++) {
            var t = i / n * TAU;
            var x = 16 * Math.pow(Math.sin(t), 3);
            var y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
            out.push({ x: x / 17, y: y / 17 });
        }
        function inside(px, py) {
            var c = false;
            for (var i = 0, j = out.length - 1; i < out.length; j = i++) {
                var a = out[i], b = out[j];
                if (((a.y > py) !== (b.y > py)) &&
                    (px < (b.x - a.x) * (py - a.y) / (b.y - a.y) + a.x)) c = !c;
            }
            return c;
        }
        function edgeDist(px, py) {
            var m = 1e9;
            for (var i = 0; i < out.length; i++) {
                var dx = out[i].x - px, dy = out[i].y - py;
                var d = dx * dx + dy * dy;
                if (d < m) m = d;
            }
            return Math.sqrt(m);
        }
        var pts = [];
        var guard = 0;
        while (pts.length < Q.petals && guard++ < Q.petals * 60) {
            var px = rr(-1.05, 1.05), py = rr(-1.15, 1.0);
            if (!inside(px, py)) continue;
            var d = edgeDist(px, py);
            var thick = 0.46 * Math.sqrt(clamp(d / 0.34, 0, 1));
            var z = (rng() < 0.5 ? -1 : 1) * thick * rr(0.75, 1);
            if (rng() < 0.16) z *= 0.15;  // 轮廓上的一些花瓣
            pts.push(V(px, py, z));
        }
        while (pts.length < Q.petals) pts.push(V(rr(-1, 1), rr(-1, 1), rr(-0.4, 0.4)));
        return pts;
    })();

    /* ------------------------------------------------------------ 粒子 */
    var stars = [];
    for (var i = 0; i < Q.stars; i++) {
        var a = rr(0, TAU), b = Math.acos(rr(-1, 1)), R = rr(50, 190);
        stars.push({
            p: V(Math.sin(b) * Math.cos(a) * R, Math.abs(Math.cos(b)) * R * 0.75 - 8, Math.sin(b) * Math.sin(a) * R),
            r: rr(0.5, 3.4), tw: rr(0, TAU), sp: rr(0.4, 2.2),
            spr: rng() < 0.14 ? SPR.ice : (rng() < 0.2 ? SPR.warm : SPR.white),
            a: rr(0.25, 0.9)
        });
    }

    var petals = [];
    function resetPetal(pt, first) {
        pt.p = V(rr(-16, 16), first ? rr(-2, 20) : rr(14, 22), rr(-14, 12));
        pt.vy = -rr(0.5, 1.5);
        pt.sw = rr(0, TAU);
        pt.swSp = rr(0.5, 1.6);
        pt.swAmp = rr(0.5, 2.0);
        pt.spin = rr(0, TAU);
        pt.spinSp = rr(-2.2, 2.2);
        pt.flip = rr(0, TAU);
        pt.flipSp = rr(0.6, 2.6);
        pt.size = rr(0.1, 0.26);
        pt.spr = SPR.petals[(rng() * SPR.petals.length) | 0];
        return pt;
    }
    for (var i2 = 0; i2 < Q.petals; i2++) {
        var pt = resetPetal({}, true);
        pt.ht = heartPts[i2 % heartPts.length];
        pt.hd = rng();          // 聚合延迟
        pt.m = 0;               // 心形混合度
        petals.push(pt);
    }

    var embers = [];
    for (var i3 = 0; i3 < Q.embers; i3++) {
        embers.push({
            p: V(rr(-18, 18), rr(-1, 18), rr(-16, 10)),
            v: rr(0.5, 1.9), sw: rr(0, TAU), swSp: rr(0.4, 1.3), swAmp: rr(0.3, 1.4),
            r: rr(0.6, 2.6), tw: rr(0, TAU), spr: rng() < 0.4 ? SPR.pink : SPR.warm, a: rr(0.3, 0.9)
        });
    }

    var flies = [];
    for (var i4 = 0; i4 < Q.flies; i4++) {
        flies.push({
            orbR: rr(4, 13), orbA: rr(0, TAU), orbSp: rr(-0.5, 0.5) || 0.2,
            y: rr(1.5, 12), ySp: rr(0.2, 0.8), yPh: rr(0, TAU),
            r: rr(1.2, 3.4), tw: rr(0, TAU), spr: rng() < 0.3 ? SPR.ice : SPR.warm,
            tail: []
        });
    }

    var shocks = [];   // 地面冲击波
    var trail = [];    // 种子拖尾
    var shooting = []; // 流星
    var nextShoot = 6;

    /* ------------------------------------------------------------- 分镜 */
    var ACT = { fall: 0.0, land: 2.3, grow: 2.55, bloom: 8.2, text: 9.4, clock: 11.0, free: 15 };
    var GROW_SPAN = 7.6;
    var started = false, T = 0, last = 0, seedY = 12.5;
    var flash = 0, shake = 0;
    var heart = { m: 0, phase: 'idle', t: 0, next: 34 };

    var light = V(-22, 30, -34);   // 主光源（体积光/耀斑）

    /* --------------------------------------------------------- 相机编排 */
    function cameraDirector(t, dt) {
        var P, Tg, fov = 46, roll = 0;
        var orbit = t * 0.055;
        if (!started) {
            P = V(Math.sin(orbit) * 30, 8.5 + Math.sin(t * 0.25) * 0.8, Math.cos(orbit) * 30);
            Tg = V(0, 9.5, 0);
            fov = 42;
        } else if (t < ACT.land) {
            var k = span(t, 0, ACT.land);
            P = V(lerp(9, 4.5, easeInOut(k)), lerp(11, 6.5, easeInOut(k)), lerp(30, 21, easeInOut(k)));
            Tg = V(0, lerp(12.5, 1.2, easeIn(sat(t / ACT.land))), 0);
            fov = lerp(40, 52, k);
            roll = lerp(-0.05, 0.01, k);
        } else if (t < ACT.grow + GROW_SPAN) {
            var g = span(t, ACT.land, ACT.grow + GROW_SPAN);
            var ang = -0.35 + g * 1.15;
            var rad = lerp(15, 25, easeOut(g));
            P = V(Math.sin(ang) * rad, lerp(1.6, 12.5, easeInOut(g)), Math.cos(ang) * rad);
            Tg = V(0, lerp(1.5, 9.5, easeOut(g)), 0);
            fov = lerp(56, 46, g);
            roll = Math.sin(g * 3.1) * 0.035;
        } else {
            var f = t - (ACT.grow + GROW_SPAN);
            var ang2 = 0.8 + f * 0.052;
            var rad2 = 27 + Math.sin(f * 0.14) * 4.5;
            var hy = heart.m;
            P = V(Math.sin(ang2) * rad2, 11 + Math.sin(f * 0.19) * 3.2, Math.cos(ang2) * rad2);
            Tg = V(0, 9 + Math.sin(f * 0.11) * 1.2, 0);
            if (hy > 0.01) {
                // 心形出现时推近并对准心
                P = vlerp(P, V(Math.sin(ang2 * 1.5) * lerp(rad2, 15, hy), lerp(P.y, 10.5, hy), Math.cos(ang2 * 1.5) * lerp(rad2, 15, hy)), hy);
                Tg = vlerp(Tg, V(0, 10.5, 0), hy);
                fov = lerp(46, 40, hy);
            }
            roll = Math.sin(f * 0.23) * 0.03 + hy * 0.02;
        }
        // 手持微抖
        var hh = 0.06 + shake;
        P = vadd(P, V(
            (Math.sin(t * 2.3) + Math.sin(t * 5.1) * 0.5) * hh,
            (Math.cos(t * 1.9) + Math.sin(t * 4.3) * 0.4) * hh,
            Math.sin(t * 1.3) * hh * 0.6
        ));
        // 临界阻尼平滑
        var k1 = 1 - Math.pow(0.0006, dt);
        cam.dpos = vlerp(cam.dpos, P, k1);
        cam.dtgt = vlerp(cam.dtgt, Tg, k1);
        cam.dfov = lerp(cam.dfov, fov, k1);
        cam.droll = lerp(cam.droll, roll, k1);
        cam.pos = cam.dpos; cam.tgt = cam.dtgt; cam.fov = cam.dfov; cam.roll = cam.droll;
        rollC = Math.cos(cam.roll); rollS = Math.sin(cam.roll);
        updateBasis();
    }

    /* ------------------------------------------------------------ 绘制 */
    function drawSprite(spr, sx, sy, size, alpha, comp) {
        if (alpha <= 0.004 || size <= 0.2) return;
        if (sx < -size || sx > canvas.width + size || sy < -size || sy > canvas.height + size) return;
        ctx.globalAlpha = alpha;
        ctx.drawImage(spr, sx - size / 2, sy - size / 2, size, size);
    }

    function horizonY() {
        var hd = vnorm(V(basis.f.x, 0, basis.f.z));
        var ez = vdot(hd, basis.f), ey = vdot(hd, basis.u);
        if (ez <= 0.001) return cy;
        return cy - focal * (ey / ez);
    }

    function drawSky(t) {
        // 星云（带视差）
        var yaw = Math.atan2(basis.f.x, basis.f.z);
        var scale = Math.max(canvas.width, canvas.height) * 1.5;
        var ox = cx - scale / 2 - yaw * canvas.width * 0.16;
        var oy = cy - scale / 2 - basis.f.y * canvas.height * 0.5 - canvas.height * 0.12;
        ctx.globalAlpha = 1;
        ctx.drawImage(nebula, ox, oy, scale, scale);
        // 顶部渐暗
        var grd = ctx.createLinearGradient(0, 0, 0, canvas.height);
        grd.addColorStop(0, 'rgba(4,2,14,0.55)');
        grd.addColorStop(0.45, 'rgba(6,3,18,0.05)');
        grd.addColorStop(1, 'rgba(2,1,8,0.5)');
        ctx.fillStyle = grd;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    function drawStars(t) {
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < stars.length; i++) {
            var s = stars[i], q = proj(s.p);
            if (!q) continue;
            var tw = 0.55 + 0.45 * Math.sin(t * s.sp + s.tw);
            drawSprite(s.spr, q.x, q.y, s.r * 12 * DPR * tw, s.a * tw * 0.85);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawGround(t) {
        var hy = horizonY();
        if (hy > -canvas.height) {
            var top = Math.max(hy, -10);
            var grd = ctx.createLinearGradient(0, top, 0, canvas.height);
            grd.addColorStop(0, 'rgba(10,6,26,0.0)');
            grd.addColorStop(0.12, 'rgba(8,5,22,0.75)');
            grd.addColorStop(1, 'rgba(3,2,10,0.98)');
            ctx.fillStyle = grd;
            ctx.fillRect(0, top, canvas.width, canvas.height - top);
            // 地平雾
            var mg = ctx.createLinearGradient(0, hy - canvas.height * 0.14, 0, hy + canvas.height * 0.1);
            mg.addColorStop(0, 'rgba(120,80,190,0)');
            mg.addColorStop(0.5, 'rgba(150,96,200,0.16)');
            mg.addColorStop(1, 'rgba(80,40,120,0)');
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = mg;
            ctx.fillRect(0, hy - canvas.height * 0.14, canvas.width, canvas.height * 0.24);
            ctx.globalCompositeOperation = 'source-over';
        }
        // 树根光池
        var base = proj(V(0, 0.02, 0));
        if (base) {
            var r = 260 * base.s / 30 * DPR + 60 * DPR;
            var pg = ctx.createRadialGradient(base.x, base.y, 0, base.x, base.y, r);
            pg.addColorStop(0, 'rgba(255,180,120,0.30)');
            pg.addColorStop(0.4, 'rgba(190,90,160,0.13)');
            pg.addColorStop(1, 'rgba(120,40,150,0)');
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = pg;
            ctx.beginPath(); ctx.ellipse(base.x, base.y, r, r * 0.34, 0, 0, TAU); ctx.fill();
            ctx.globalCompositeOperation = 'source-over';
        }
    }

    function drawRays(t) {
        var L = proj(light);
        if (!L) return;
        ctx.globalCompositeOperation = 'lighter';
        var len = Math.max(canvas.width, canvas.height) * 1.7;
        for (var i = 0; i < Q.rays; i++) {
            var a = (i / Q.rays) * 0.9 - 0.45 + Math.PI * 0.62 + Math.sin(t * 0.07 + i) * 0.05;
            var w = (26 + Math.sin(t * 0.5 + i * 2.1) * 16) * DPR;
            var al = 0.030 + 0.022 * (0.5 + 0.5 * Math.sin(t * 0.33 + i * 1.7));
            ctx.save();
            ctx.translate(L.x, L.y);
            ctx.rotate(a);
            var g = ctx.createLinearGradient(0, 0, len, 0);
            g.addColorStop(0, 'rgba(255,214,170,' + al * 2.2 + ')');
            g.addColorStop(0.35, 'rgba(255,180,150,' + al + ')');
            g.addColorStop(1, 'rgba(255,140,180,0)');
            ctx.fillStyle = g;
            ctx.beginPath();
            ctx.moveTo(0, -w * 0.18);
            ctx.lineTo(len, -w);
            ctx.lineTo(len, w);
            ctx.lineTo(0, w * 0.18);
            ctx.closePath();
            ctx.fill();
            ctx.restore();
        }
        // 光源本体 + 耀斑
        drawSprite(SPR.warm, L.x, L.y, 420 * DPR, 0.5);
        drawSprite(SPR.white, L.x, L.y, 150 * DPR, 0.45);
        var dx = cx - L.x, dy = cy - L.y;
        for (var k = 1; k <= 5; k++) {
            var f = k * 0.42;
            drawSprite(k % 2 ? SPR.violet : SPR.ice,
                L.x + dx * f, L.y + dy * f, (40 + k * 26) * DPR, 0.1);
        }
        // 横向变形宽银幕光条
        ctx.save();
        ctx.translate(L.x, L.y);
        var sg = ctx.createLinearGradient(-canvas.width, 0, canvas.width, 0);
        sg.addColorStop(0, 'rgba(120,180,255,0)');
        sg.addColorStop(0.5, 'rgba(170,205,255,0.30)');
        sg.addColorStop(1, 'rgba(120,180,255,0)');
        ctx.fillStyle = sg;
        ctx.fillRect(-canvas.width, -2.2 * DPR, canvas.width * 2, 4.4 * DPR);
        ctx.restore();
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    // 树枝：深色剪影 + 暖边缘光
    function drawTree(t, mirror) {
        var growT = T - ACT.grow;
        var lp = proj(light);
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';
        for (var i = 0; i < branches.length; i++) {
            var b = branches[i];
            var p = sat((growT - b.t0) / b.dur);
            if (p <= 0) continue;
            var n = b.nodes.length;
            var upto = p * (n - 1);
            var count = Math.floor(upto);
            var frac = upto - count;
            var prev = null, prevR = 0;
            for (var j = 0; j <= count; j++) {
                var w = windOffset(b, j, t);
                var wp = vadd(b.nodes[j].p, w);
                var q = proj(wp, mirror);
                var rad = b.nodes[j].r;
                if (q && mirror) q.x += Math.sin(q.y * 0.05 / DPR + t * 1.7) * 3.4 * DPR;
                if (prev && q) {
                    var lw = Math.max(0.6 * DPR, (rad + prevR) * 0.5 * q.s);
                    ctx.strokeStyle = mirror ? 'rgba(40,22,54,0.55)' : '#170d20';
                    ctx.lineWidth = lw;
                    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q.x, q.y); ctx.stroke();
                    // 边缘光
                    if (lw > 1.1 * DPR) {
                        var ox = 0, oy = -lw * 0.26;
                        if (lp) {
                            var ldx = lp.x - q.x, ldy = lp.y - q.y;
                            var ll = Math.sqrt(ldx * ldx + ldy * ldy) || 1;
                            ox = ldx / ll * lw * 0.26; oy = ldy / ll * lw * 0.26;
                        }
                        ctx.strokeStyle = 'rgba(255,168,110,' + (mirror ? 0.10 : 0.30) + ')';
                        ctx.lineWidth = lw * 0.42;
                        ctx.beginPath();
                        ctx.moveTo(prev.x + ox, prev.y + oy);
                        ctx.lineTo(q.x + ox, q.y + oy);
                        ctx.stroke();
                    }
                }
                prev = q; prevR = rad;
            }
            // 正在生长的末段
            if (count < n - 1 && prev) {
                var a1 = b.nodes[count].p, a2 = b.nodes[count + 1].p;
                var mp = vadd(vlerp(a1, a2, frac), windOffset(b, count + frac, t));
                var q2 = proj(mp, mirror);
                if (q2) {
                    if (mirror) q2.x += Math.sin(q2.y * 0.05 / DPR + t * 1.7) * 3.4 * DPR;
                    ctx.strokeStyle = mirror ? 'rgba(40,22,54,0.5)' : '#170d20';
                    ctx.lineWidth = Math.max(0.6 * DPR, b.nodes[count].r * q2.s);
                    ctx.beginPath(); ctx.moveTo(prev.x, prev.y); ctx.lineTo(q2.x, q2.y); ctx.stroke();
                    if (!mirror) {
                        ctx.globalCompositeOperation = 'lighter';
                        drawSprite(SPR.warm, q2.x, q2.y, 46 * DPR * clamp(q2.s / 40, 0.4, 2), 0.55);
                        ctx.globalCompositeOperation = 'source-over';
                    }
                }
            }
        }
        ctx.globalAlpha = 1;
    }

    function drawBlossoms(t, mirror) {
        var growT = T - ACT.grow;
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < blossoms.length; i++) {
            var f = blossoms[i];
            var age = growT - f.t0;
            if (age <= 0) continue;
            var pop = sat(age / 0.9);
            var sc = easeOut(pop) * (1 + 0.16 * Math.sin(t * 1.6 + f.twk));
            var w = windOffset(f.host, f.host.nodes.length - 1, t);
            var q = proj(vadd(f.p, w), mirror);
            if (!q) continue;
            if (mirror) q.x += Math.sin(q.y * 0.05 / DPR + t * 1.7) * 3.4 * DPR;
            var px = q.x, py = q.y;
            var size = f.size * q.s * sc;
            var al = (mirror ? 0.22 : 1) * (0.75 + 0.25 * Math.sin(t * 2.1 + f.twk));
            // 花心光晕
            drawSprite(f.tone % 3 === 0 ? SPR.warm : SPR.pink, px, py, size * 9, al * 0.5);
            // 五枚花瓣
            var spr = SPR.petals[f.tone % SPR.petals.length];
            ctx.save();
            ctx.translate(px, py);
            ctx.rotate(f.spin + t * 0.12);
            for (var k = 0; k < 5; k++) {
                ctx.rotate(TAU / 5);
                ctx.globalAlpha = al * 0.9;
                ctx.drawImage(spr, size * 0.15, -size * 0.9, size * 1.9, size * 1.9);
            }
            ctx.restore();
            if (pop < 1 && !mirror) {
                drawSprite(SPR.white, px, py, size * 16 * (1 - pop), (1 - pop) * 0.5);
            }
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function beat(x) {
        var p = (x % 1.25) / 1.25;
        return Math.exp(-9 * p) + 0.55 * Math.exp(-11 * Math.max(0, p - 0.24));
    }

    function heartWorld(pt, t) {
        var s = 7.2 * (1 + 0.055 * beat(t));
        var yaw = t * 0.32, tilt = Math.sin(t * 0.21) * 0.12;
        var p = pt.ht;
        var x = p.x * s, y = p.y * s, z = p.z * s;
        var c = Math.cos(yaw), si = Math.sin(yaw);
        var rx = x * c + z * si, rz = -x * si + z * c;
        var ry = y * Math.cos(tilt) - rz * Math.sin(tilt);
        rz = y * Math.sin(tilt) + rz * Math.cos(tilt);
        return V(rx, ry + 10.8, rz);
    }

    function updatePetals(t, dt) {
        for (var i = 0; i < petals.length; i++) {
            var p = petals[i];
            p.sw += p.swSp * dt;
            p.spin += p.spinSp * dt;
            p.flip += p.flipSp * dt;
            p.p.y += p.vy * dt;
            p.p.x += Math.sin(p.sw) * p.swAmp * dt;
            p.p.z += Math.cos(p.sw * 0.8) * p.swAmp * 0.6 * dt;
            if (p.p.y < -1.5) resetPetal(p, false);
            // 心形混合度
            var target = 0;
            if (heart.m > 0) {
                var d = (p.hd - 0.5) * 0.5;
                target = sat((heart.m - 0.15 - d * 0.4) / 0.6);
            }
            p.m += (target - p.m) * (1 - Math.pow(0.02, dt));
        }
    }

    function drawPetals(t, mirror) {
        var petalStart = ACT.bloom - 0.5;
        if (T < petalStart) return;
        var gate = sat((T - petalStart) / 3);
        ctx.globalCompositeOperation = 'lighter';
        var focusD = vlen(vsub(cam.tgt, cam.pos));
        for (var i = 0; i < petals.length; i++) {
            var p = petals[i];
            if (i / petals.length > gate) continue;
            var wp = p.p;
            if (p.m > 0.001) wp = vlerp(p.p, heartWorld(p, t), easeInOut(p.m));
            var q = proj(wp, mirror);
            if (!q) continue;
            if (mirror) q.x += Math.sin(q.y * 0.05 / DPR + t * 1.7) * 3.4 * DPR;
            // 景深散景
            var coc = clamp(Math.abs(q.z - focusD) / focusD, 0, 1);
            var blur = 1 + coc * 2.6;
            var size = p.size * q.s * 2.2 * blur;
            var al = (mirror ? 0.2 : 1) * (0.95 / (blur * blur * 0.55 + 0.45));
            var squash = Math.abs(Math.cos(p.flip)) * 0.8 + 0.2;
            ctx.save();
            ctx.translate(q.x, q.y);
            ctx.rotate(p.spin);
            ctx.scale(1, squash);
            ctx.globalAlpha = clamp(al, 0, 1);
            ctx.drawImage(p.spr, -size / 2, -size / 2, size, size);
            ctx.restore();
            if (p.m > 0.3) {
                drawSprite(SPR.rose, q.x, q.y, size * 2.6, 0.16 * p.m * (mirror ? 0.3 : 1));
            }
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawEmbers(t, dt) {
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < embers.length; i++) {
            var e = embers[i];
            e.p.y += e.v * dt;
            e.sw += e.swSp * dt;
            e.p.x += Math.sin(e.sw) * e.swAmp * dt;
            if (e.p.y > 22) { e.p.y = -1; e.p.x = rr(-18, 18); e.p.z = rr(-16, 10); }
            var q = proj(e.p);
            if (!q) continue;
            var tw = 0.5 + 0.5 * Math.sin(t * 2.2 + e.tw);
            var fade = 1 - sat((e.p.y - 8) / 14);
            drawSprite(e.spr, q.x, q.y, e.r * q.s * 0.9, e.a * tw * fade * 0.8);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawFlies(t, dt) {
        ctx.globalCompositeOperation = 'lighter';
        for (var i = 0; i < flies.length; i++) {
            var f = flies[i];
            f.orbA += f.orbSp * dt;
            var cr = f.orbR * (heart.m > 0 ? lerp(1, 0.62, heart.m) : 1);
            var y = f.y + Math.sin(t * f.ySp + f.yPh) * 1.6 + heart.m * 2.4;
            var p = V(Math.cos(f.orbA) * cr, y, Math.sin(f.orbA) * cr * 0.85);
            var q = proj(p);
            if (!q) continue;
            f.tail.push({ x: q.x, y: q.y });
            if (f.tail.length > 9) f.tail.shift();
            var tw = 0.45 + 0.55 * Math.abs(Math.sin(t * 1.7 + f.tw));
            // 拖尾
            ctx.strokeStyle = 'rgba(255,208,150,0.10)';
            ctx.lineWidth = 1.3 * DPR;
            ctx.beginPath();
            for (var k = 0; k < f.tail.length; k++) {
                if (k === 0) ctx.moveTo(f.tail[k].x, f.tail[k].y);
                else ctx.lineTo(f.tail[k].x, f.tail[k].y);
            }
            ctx.stroke();
            drawSprite(f.spr, q.x, q.y, f.r * q.s * 0.8, tw * 0.85);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawSeed(t) {
        if (T > ACT.land + 0.4) return;
        var y = started ? lerp(12.5, 0.05, easeIn(span(T, 0, ACT.land))) : 12.5 + Math.sin(t * 0.9) * 0.45;
        var p = V(0, y, 0);
        var q = proj(p);
        if (!q) return;
        // 拖尾
        if (started) {
            trail.push({ p: V(p.x + rr(-0.1, 0.1), y, p.z + rr(-0.1, 0.1)), life: 1, r: rr(0.4, 1.4) });
        }
        ctx.globalCompositeOperation = 'lighter';
        var pulse = 0.72 + 0.28 * Math.sin(t * 2.4);
        drawSprite(SPR.warm, q.x, q.y, 320 * DPR * pulse * (started ? 1.25 : 1), 0.55);
        drawSprite(SPR.pink, q.x, q.y, 150 * DPR * pulse, 0.6);
        drawSprite(SPR.white, q.x, q.y, 52 * DPR, 0.95);
        // 环绕的光尘
        for (var i = 0; i < 22; i++) {
            var a = t * 1.1 + i / 22 * TAU;
            var rad = 1.5 + Math.sin(t * 1.5 + i) * 0.4;
            var sp = proj(V(Math.cos(a) * rad, y + Math.sin(t * 2 + i) * 0.6, Math.sin(a) * rad));
            if (sp) drawSprite(SPR.ice, sp.x, sp.y, 26 * DPR, 0.35);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawTrail(t, dt) {
        if (!trail.length) return;
        ctx.globalCompositeOperation = 'lighter';
        for (var i = trail.length - 1; i >= 0; i--) {
            var tr = trail[i];
            tr.life -= dt * 0.85;
            if (tr.life <= 0) { trail.splice(i, 1); continue; }
            var q = proj(tr.p);
            if (!q) continue;
            drawSprite(SPR.warm, q.x, q.y, tr.r * q.s * 1.6 * tr.life, tr.life * 0.5);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawShocks(t, dt) {
        if (!shocks.length) return;
        ctx.globalCompositeOperation = 'lighter';
        for (var i = shocks.length - 1; i >= 0; i--) {
            var s = shocks[i];
            s.t += dt;
            var k = s.t / s.dur;
            if (k >= 1) { shocks.splice(i, 1); continue; }
            var rad = easeOut(k) * s.max;
            var al = (1 - k) * (1 - k) * 0.8;
            ctx.strokeStyle = 'rgba(255,196,150,' + al + ')';
            ctx.lineWidth = Math.max(1, 4 * DPR * (1 - k));
            ctx.beginPath();
            var first = true;
            for (var a = 0; a <= 48; a++) {
                var ang = a / 48 * TAU;
                var q = proj(V(Math.cos(ang) * rad, 0.03, Math.sin(ang) * rad));
                if (!q) { first = true; continue; }
                if (first) { ctx.moveTo(q.x, q.y); first = false; }
                else ctx.lineTo(q.x, q.y);
            }
            ctx.stroke();
            ctx.strokeStyle = 'rgba(255,120,190,' + al * 0.5 + ')';
            ctx.lineWidth = Math.max(1, 10 * DPR * (1 - k));
            ctx.stroke();
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    function drawShooting(t, dt) {
        nextShoot -= dt;
        if (nextShoot <= 0) {
            nextShoot = rr(7, 17);
            var a = rr(0, TAU);
            shooting.push({
                p: V(Math.cos(a) * 90, rr(45, 85), Math.sin(a) * 90),
                v: V(rr(-30, 30), rr(-22, -9), rr(-30, 30)),
                life: 1
            });
        }
        ctx.globalCompositeOperation = 'lighter';
        for (var i = shooting.length - 1; i >= 0; i--) {
            var s = shooting[i];
            var prev = V(s.p.x, s.p.y, s.p.z);
            s.p = vadd(s.p, vmul(s.v, dt));
            s.life -= dt * 0.35;
            if (s.life <= 0) { shooting.splice(i, 1); continue; }
            var q1 = proj(prev), q2 = proj(s.p);
            if (!q1 || !q2) continue;
            var g = ctx.createLinearGradient(q1.x, q1.y, q2.x, q2.y);
            g.addColorStop(0, 'rgba(255,255,255,0)');
            g.addColorStop(1, 'rgba(220,235,255,' + s.life * 0.9 + ')');
            ctx.strokeStyle = g;
            ctx.lineWidth = 2.2 * DPR;
            ctx.beginPath();
            var dx = q2.x - q1.x, dy = q2.y - q1.y;
            ctx.moveTo(q2.x - dx * 26, q2.y - dy * 26);
            ctx.lineTo(q2.x, q2.y);
            ctx.stroke();
            drawSprite(SPR.white, q2.x, q2.y, 40 * DPR, s.life * 0.8);
        }
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
    }

    /* ------------------------------------------------------------ 后期 */
    function postFX(t) {
        // 泛光
        if (Q.bloom) {
            bloomG.globalCompositeOperation = 'source-over';
            bloomG.clearRect(0, 0, bloomC.width, bloomC.height);
            bloomG.filter = 'blur(' + (3 * DPR).toFixed(1) + 'px) brightness(1.5) saturate(1.35) contrast(1.35)';
            bloomG.drawImage(canvas, 0, 0, bloomC.width, bloomC.height);
            bloomG.filter = 'none';
            ctx.globalCompositeOperation = 'lighter';
            ctx.globalAlpha = 0.55;
            ctx.drawImage(bloomC, 0, 0, canvas.width, canvas.height);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
        }
        // 色彩分级（暗部青紫 / 亮部暖橘）
        var g = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
        g.addColorStop(0, 'rgba(70,40,150,0.20)');
        g.addColorStop(0.5, 'rgba(30,10,40,0.05)');
        g.addColorStop(1, 'rgba(255,140,80,0.16)');
        ctx.globalCompositeOperation = 'soft-light';
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.globalCompositeOperation = 'source-over';

        // 暗角
        var vg = ctx.createRadialGradient(cx, cy * 0.94, Math.min(cx, cy) * 0.42,
            cx, cy, Math.max(cx, cy) * 1.12);
        vg.addColorStop(0, 'rgba(0,0,0,0)');
        vg.addColorStop(0.72, 'rgba(3,1,10,0.34)');
        vg.addColorStop(1, 'rgba(2,0,8,0.86)');
        ctx.fillStyle = vg;
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 闪光
        if (flash > 0.002) {
            ctx.globalCompositeOperation = 'lighter';
            ctx.fillStyle = 'rgba(255,236,214,' + flash * 0.85 + ')';
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            ctx.globalCompositeOperation = 'source-over';
        }

        // 胶片颗粒
        if (Q.grain && grainPat) {
            ctx.save();
            ctx.globalCompositeOperation = 'overlay';
            ctx.globalAlpha = 0.055;
            ctx.translate((Math.random() * 180) | 0, (Math.random() * 180) | 0);
            ctx.fillStyle = grainPat;
            ctx.fillRect(-180, -180, canvas.width + 360, canvas.height + 360);
            ctx.restore();
        }
        ctx.globalAlpha = 1;
    }

    /* ------------------------------------------------------- 心形节拍器 */
    function updateHeart(t, dt) {
        if (T < ACT.free + 8) return;
        heart.next -= dt;
        if (heart.phase === 'idle' && heart.next <= 0) { heart.phase = 'in'; heart.t = 0; }
        if (heart.phase === 'in') {
            heart.t += dt; heart.m = easeInOut(sat(heart.t / 4.5));
            if (heart.t >= 4.5) { heart.phase = 'hold'; heart.t = 0; }
        } else if (heart.phase === 'hold') {
            heart.t += dt; heart.m = 1;
            if (heart.t >= 12) { heart.phase = 'out'; heart.t = 0; }
        } else if (heart.phase === 'out') {
            heart.t += dt; heart.m = 1 - easeInOut(sat(heart.t / 3.5));
            if (heart.t >= 3.5) { heart.phase = 'idle'; heart.m = 0; heart.next = rr(16, 24); }
        }
    }

    /* --------------------------------------------------------- 文字编排 */
    var textDone = false, clockDone = false, clockTimer = null;
    function revealText() {
        if (textDone) return;
        textDone = true;
        var code = document.getElementById('code');
        if (!code) return;
        code.style.display = 'block';
        var lines = code.querySelectorAll('.line');
        for (var i = 0; i < lines.length; i++) {
            (function (el, i) {
                setTimeout(function () { el.className += ' in'; }, i * 1150);
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
            clockTimer = setInterval(function () { timeElapse(d); }, 1000);
        }
    }

    /* -------------------------------------------------------------- 主帧 */
    function frame(now) {
        var dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
        last = now;
        var t = now / 1000;
        if (started) T += dt;

        // 自愈：面板从隐藏变为显示、或尺寸变化时重建缓冲区
        if (W !== window.innerWidth || H !== window.innerHeight) {
            if (window.innerWidth > 0 && window.innerHeight > 0) resize();
        }

        // 事件
        if (started && !window.__landed && T >= ACT.land) {
            window.__landed = true;
            flash = 1; shake = 0.9;
            shocks.push({ t: 0, dur: 2.6, max: 26 });
            shocks.push({ t: -0.25, dur: 3.4, max: 40 });
        }
        flash *= Math.pow(0.02, dt);
        shake *= Math.pow(0.05, dt);
        if (started && T >= ACT.text) revealText();
        if (started && T >= ACT.clock) revealClock();

        updateHeart(t, dt);
        cameraDirector(T, dt);
        updatePetals(t, dt);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        drawSky(t);
        drawStars(t);
        drawRays(t);
        drawShooting(t, dt);
        drawGround(t);

        // 水面倒影（先画，再被地面雾气压暗）
        if (Q.reflect) {
            ctx.save();
            if (supportsFilter) ctx.filter = 'blur(' + (1.6 * DPR).toFixed(1) + 'px)';
            ctx.globalAlpha = 1;
            drawTree(t, true);
            drawBlossoms(t, true);
            drawPetals(t, true);
            ctx.filter = 'none';
            ctx.restore();
            // 倒影上的水雾
            var hy = horizonY();
            var wg = ctx.createLinearGradient(0, hy, 0, canvas.height);
            wg.addColorStop(0, 'rgba(6,4,18,0.55)');
            wg.addColorStop(1, 'rgba(3,2,10,0.9)');
            ctx.fillStyle = wg;
            ctx.fillRect(0, hy, canvas.width, canvas.height - hy);
        }

        drawShocks(t, dt);
        drawTree(t, false);
        drawBlossoms(t, false);
        drawEmbers(t, dt);
        drawPetals(t, false);
        drawFlies(t, dt);
        drawTrail(t, dt);
        drawSeed(t);

        postFX(t);
        requestAnimationFrame(frame);
    }

    /* -------------------------------------------------------------- 交互 */
    document.body.className += ' await';
    function start() {
        if (started) return;
        started = true;
        T = 0;
        document.body.className = document.body.className.replace(' await', '') + ' cine playing';
        // 借用户这次点击把音乐放起来
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
