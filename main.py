"""
Dual N-Back  ·  v2
──────────────────
Two simultaneous streams every trial:
  • VISUAL  — a square lights up in a 3×3 grid      → press A
  • AUDIO   — a distinct tone plays for each letter  → press L

N is unlimited.  Press T on the menu to toggle light / dark mode.
"""

import os, sys, math, random, io, wave, time
import numpy as np
import pygame

# ── Window ─────────────────────────────────────────────────────────────────────
W, H = 920, 720
FPS  = 60

# ── Timing ─────────────────────────────────────────────────────────────────────
STIM_DURATION  = 0.50   # seconds cell + tone stay "on"
TRIAL_INTERVAL = 3.00   # total seconds per trial
TRIALS_BASE    = 20

# ── Letters / audio ────────────────────────────────────────────────────────────
LETTERS = ['C', 'H', 'K', 'L', 'Q', 'R', 'S', 'T']
FREQS   = [261.63, 293.66, 329.63, 392.00, 440.00, 523.25, 587.33, 659.25]
MATCH_RATE = 0.30
SAMPLE_RATE = 22050

# ── Fonts (fallback to system sans if Poppins unavailable) ─────────────────────
_POPPINS = {
    "bold":    "/usr/share/fonts/truetype/google-fonts/Poppins-Bold.ttf",
    "medium":  "/usr/share/fonts/truetype/google-fonts/Poppins-Medium.ttf",
    "regular": "/usr/share/fonts/truetype/google-fonts/Poppins-Regular.ttf",
    "light":   "/usr/share/fonts/truetype/google-fonts/Poppins-Light.ttf",
}

# ── Theme ──────────────────────────────────────────────────────────────────────

class Theme:
    """All colour tokens for one mode."""
    def __init__(self, dark: bool):
        self.dark = dark
        if dark:
            self.bg          = (11,  13,  22)
            self.surface     = (20,  23,  38)
            self.surface2    = (28,  32,  52)
            self.border      = (42,  48,  80)
            self.cell_idle   = (28,  32,  54)
            self.cell_border = (44,  50,  88)
            self.text        = (225, 228, 255)
            self.text_dim    = ( 82,  90, 138)
            self.text_faint  = ( 48,  54,  90)
            self.accent_pos  = ( 82, 144, 255)   # blue  – position
            self.accent_let  = (168,  90, 248)   # violet – letter
            self.cell_lit    = ( 82, 144, 255)
            self.glow_col    = ( 82, 144, 255)
            self.hit         = ( 62, 200, 120)
            self.miss        = (240,  80,  80)
            self.btn_press   = (255, 214,  60)
            self.progress_bg = ( 28,  32,  54)
            self.pill_bg     = ( 24,  27,  46)
        else:
            self.bg          = (235, 238, 250)
            self.surface     = (255, 255, 255)
            self.surface2    = (244, 246, 255)
            self.border      = (210, 216, 238)
            self.cell_idle   = (220, 225, 245)
            self.cell_border = (195, 203, 232)
            self.text        = ( 22,  26,  52)
            self.text_dim    = ( 95, 104, 150)
            self.text_faint  = (160, 170, 210)
            self.accent_pos  = ( 55, 115, 230)
            self.accent_let  = (140,  60, 220)
            self.cell_lit    = ( 55, 115, 230)
            self.glow_col    = ( 55, 115, 230)
            self.hit         = ( 32, 168,  88)
            self.miss        = (210,  50,  50)
            self.btn_press   = (220, 160,   0)
            self.progress_bg = (210, 216, 238)
            self.pill_bg     = (228, 232, 248)


# ── Audio ──────────────────────────────────────────────────────────────────────

def _make_tone(freq: float, duration=0.45) -> pygame.mixer.Sound:
    t = np.linspace(0, duration, int(SAMPLE_RATE * duration), False)
    vib = 1 + 0.003 * np.sin(2 * np.pi * 5.5 * t)
    tone = (0.55 * np.sin(2*np.pi*freq*vib*t)
          + 0.25 * np.sin(2*np.pi*freq*2*vib*t)
          + 0.12 * np.sin(2*np.pi*freq*3*vib*t)
          + 0.08 * np.sin(2*np.pi*freq*0.5*t))
    a, r = int(SAMPLE_RATE*0.015), int(SAMPLE_RATE*0.20)
    env = np.ones(len(t))
    env[:a] = np.linspace(0, 1, a)
    env[-r:] = np.linspace(1, 0, r)
    s = (tone * env * 0.55 * 32767).astype(np.int16)
    stereo = np.column_stack([s, s])
    buf = io.BytesIO()
    with wave.open(buf, 'w') as wf:
        wf.setnchannels(2); wf.setsampwidth(2); wf.setframerate(SAMPLE_RATE)
        wf.writeframes(stereo.tobytes())
    buf.seek(0)
    return pygame.mixer.Sound(file=buf)


def build_sounds(audio_ok):
    if not audio_ok:
        return {}
    return {l: _make_tone(f) for l, f in zip(LETTERS, FREQS)}


# ── Sequence ───────────────────────────────────────────────────────────────────

def generate_sequence(n, trials):
    total = trials + n
    seq = [[random.choice(LETTERS), random.randint(0, 8)] for _ in range(total)]
    for i in range(n, total):
        if random.random() < MATCH_RATE:
            seq[i][0] = seq[i-n][0]
        if random.random() < MATCH_RATE:
            seq[i][1] = seq[i-n][1]
    return [(s[0], s[1]) for s in seq]


# ── Drawing helpers ─────────────────────────────────────────────────────────────

def lerp(a, b, t):
    t = max(0.0, min(1.0, t))
    return tuple(int(a[i] + (b[i]-a[i])*t) for i in range(3))

def ease_out(t):
    return 1 - (1-t)**3

def draw_rrect(surf, color, rect, r=14, width=0, border_col=None):
    pygame.draw.rect(surf, color, rect, border_radius=r)
    if width and border_col:
        pygame.draw.rect(surf, border_col, rect, width, border_radius=r)

def draw_text(surf, text, font, color, cx, cy, anchor="center"):
    img = font.render(text, True, color)
    rc = img.get_rect()
    setattr(rc, anchor, (cx, cy))
    surf.blit(img, rc)

def alpha_surface(w, h):
    s = pygame.Surface((w, h), pygame.SRCALPHA)
    s.fill((0, 0, 0, 0))
    return s

def draw_glow(surf, cx, cy, radius, color, alpha_peak=120):
    """Soft radial glow using concentric transparent circles."""
    steps = 18
    glow = alpha_surface(radius*2+4, radius*2+4)
    for i in range(steps, 0, -1):
        r = int(radius * i / steps)
        a = int(alpha_peak * (1 - i/steps) ** 1.6)
        pygame.draw.circle(glow, (*color, a), (radius+2, radius+2), r)
    surf.blit(glow, (cx - radius - 2, cy - radius - 2),
              special_flags=pygame.BLEND_RGBA_ADD)


# ── Font loader ────────────────────────────────────────────────────────────────

def load_fonts():
    def F(key, size):
        try:
            return pygame.font.Font(_POPPINS[key], size)
        except Exception:
            return pygame.font.SysFont("sans", size)
    return {
        "huge":   F("bold",    72),
        "big":    F("bold",    44),
        "med":    F("medium",  24),
        "body":   F("regular", 18),
        "small":  F("regular", 15),
        "label":  F("light",   13),
    }


# ── Stat helpers ───────────────────────────────────────────────────────────────

def accuracy(hits, misses, fa, cr):
    total = hits + misses + fa + cr
    return (hits + cr) / total * 100 if total else 0.0


# ── Game ───────────────────────────────────────────────────────────────────────

class DualNBack:
    CELL   = 112
    GAP    = 12
    RADIUS = 18

    # Grid top-left origin (centred horizontally, fixed vertically)
    @property
    def grid_origin(self):
        gw = 3*self.CELL + 2*self.GAP
        return ((W - gw)//2, 158)

    def grid_rect(self, idx):
        col, row = idx%3, idx//3
        ox, oy = self.grid_origin
        return pygame.Rect(ox + col*(self.CELL+self.GAP),
                           oy + row*(self.CELL+self.GAP),
                           self.CELL, self.CELL)

    def grid_center(self, idx):
        r = self.grid_rect(idx)
        return r.centerx, r.centery

    def __init__(self, n, trials, audio_ok, sounds, theme, fonts):
        self.n, self.trials = n, trials
        self.audio_ok, self.sounds = audio_ok, sounds
        self.theme, self.fonts = theme, fonts

        self.sequence   = generate_sequence(n, trials)
        self.total_steps = len(self.sequence)
        self.step       = 0

        self.pos_hits = self.pos_misses = self.pos_fa = self.pos_cr = 0
        self.let_hits = self.let_misses = self.let_fa = self.let_cr = 0

        self.stim_start    = None
        self.stim_active   = False
        self.responded_pos = False
        self.responded_let = False
        self.scored        = False

        # flash[(stream)] = (colour, expiry)
        self.flash     = {"pos": None, "let": None}
        self.key_flash = {"pos": 0.0, "let": 0.0}

        self.done = self.quit = False

    # ── Trial lifecycle ───────────────────────────────────────────────────────

    def start_trial(self):
        self.stim_start    = time.time()
        self.stim_active   = True
        self.responded_pos = self.responded_let = self.scored = False
        letter, _ = self.sequence[self.step]
        if self.audio_ok and letter in self.sounds:
            self.sounds[letter].play()

    def score_trial(self):
        if self.scored:
            return
        self.scored = True
        if self.step < self.n:
            return
        letter, pos   = self.sequence[self.step]
        pl, pp        = self.sequence[self.step - self.n]
        pos_match     = (pos == pp)
        let_match     = (letter == pl)

        for match, responded, hit_attr, miss_attr, fa_attr, cr_attr, stream in [
            (pos_match, self.responded_pos,
             "pos_hits","pos_misses","pos_fa","pos_cr","pos"),
            (let_match, self.responded_let,
             "let_hits","let_misses","let_fa","let_cr","let"),
        ]:
            if match and responded:
                setattr(self, hit_attr, getattr(self, hit_attr)+1)
                self.flash[stream] = (self.theme.hit, time.time()+0.6)
            elif match and not responded:
                setattr(self, miss_attr, getattr(self, miss_attr)+1)
                self.flash[stream] = (self.theme.miss, time.time()+0.6)
            elif not match and responded:
                setattr(self, fa_attr, getattr(self, fa_attr)+1)
                self.flash[stream] = (self.theme.miss, time.time()+0.6)
            else:
                setattr(self, cr_attr, getattr(self, cr_attr)+1)

    def advance(self):
        self.step += 1
        if self.step >= self.total_steps:
            self.done = True
        else:
            self.start_trial()

    def handle_key(self, key):
        if key in (pygame.K_ESCAPE, pygame.K_q):
            self.quit = True
        elif key == pygame.K_a and not self.responded_pos:
            self.responded_pos = True
            self.key_flash["pos"] = time.time()
        elif key == pygame.K_l and not self.responded_let:
            self.responded_let = True
            self.key_flash["let"] = time.time()

    # ── Draw ──────────────────────────────────────────────────────────────────

    def draw(self, surf):
        T = self.theme
        F = self.fonts
        now  = time.time()
        elapsed = (now - self.stim_start) if self.stim_start else 0
        stim_on = self.stim_active and elapsed < STIM_DURATION
        t_in    = ease_out(min(1.0, elapsed / 0.10)) if stim_on else 0.0
        t_out   = ease_out(min(1.0, max(0.0, elapsed - STIM_DURATION) / 0.18)) if not stim_on else 0.0

        letter, pos = self.sequence[self.step] if self.step < self.total_steps else ('?', 0)

        surf.fill(T.bg)

        # ── Top bar: N badge + counter ────────────────────────────────────────
        badge_r = pygame.Rect(W//2-38, 16, 76, 34)
        draw_rrect(surf, T.surface, badge_r, r=17)
        draw_rrect(surf, T.bg, badge_r, r=17, width=1, border_col=T.border)
        draw_text(surf, f"{self.n}-back", F["small"], T.accent_pos, W//2, 33)

        scoreable = max(0, self.step - self.n + 1)
        draw_text(surf, f"{scoreable} / {self.trials}", F["label"], T.text_faint, W//2, 62)

        # ── Letter display ────────────────────────────────────────────────────
        if stim_on:
            letter_col = lerp(T.text_dim, T.text, t_in)
            letter_disp = letter
        else:
            fade = 1.0 - min(1.0, t_out * 2)
            letter_col = lerp(T.bg, T.text_dim, fade * 0.5)
            letter_disp = letter

        draw_text(surf, letter_disp, F["huge"], letter_col, W//2, 118)

        # ── Grid ──────────────────────────────────────────────────────────────
        cx, cy = self.grid_center(pos)

        # Glow behind the active cell (rendered before cell so cell sits on top)
        if stim_on and t_in > 0.05:
            glow_alpha = int(t_in * 95)
            glow_r = int(self.CELL * 0.85)
            # Soft outer glow
            draw_glow(surf, cx, cy, glow_r + 20, T.glow_col, alpha_peak=glow_alpha)
            # Tighter inner glow
            draw_glow(surf, cx, cy, glow_r,      T.glow_col, alpha_peak=glow_alpha * 2)
        elif not stim_on and t_out < 1.0:
            fade_a = int((1-t_out) * 55)
            draw_glow(surf, cx, cy, int(self.CELL*0.8), T.glow_col, alpha_peak=fade_a)

        for idx in range(9):
            r = self.grid_rect(idx)
            if stim_on and idx == pos:
                col = lerp(T.cell_idle, T.cell_lit, t_in)
                draw_rrect(surf, col, r, self.RADIUS)
                # Inner highlight rim
                rim_col = lerp(T.cell_lit, (255,255,255), 0.35)
                draw_rrect(surf, T.bg, r, self.RADIUS, width=1, border_col=rim_col)
            elif not stim_on and idx == pos and t_out < 1.0:
                col = lerp(T.cell_lit, T.cell_idle, t_out)
                draw_rrect(surf, col, r, self.RADIUS)
                draw_rrect(surf, T.bg, r, self.RADIUS, width=1, border_col=T.cell_border)
            else:
                draw_rrect(surf, T.cell_idle, r, self.RADIUS)
                draw_rrect(surf, T.bg, r, self.RADIUS, width=1, border_col=T.cell_border)

        # ── Buttons ───────────────────────────────────────────────────────────
        bw, bh = 182, 56
        gap_b  = 28
        bx_a   = W//2 - bw - gap_b//2
        bx_l   = W//2 + gap_b//2
        by     = H - 128

        for label, bx, stream, base_col in [
            ("A   Position", bx_a, "pos", T.accent_pos),
            ("L   Letter",   bx_l, "let", T.accent_let),
        ]:
            flash_info = self.flash.get(stream)
            key_age    = now - self.key_flash.get(stream, 0)
            key_lit    = key_age < 0.14

            if key_lit:
                fill = T.btn_press
                txt_col = (20, 20, 30)
            elif flash_info and now < flash_info[1]:
                fill = flash_info[0]
                txt_col = (255, 255, 255)
            else:
                fill = base_col
                txt_col = (255, 255, 255)

            btn_r = pygame.Rect(bx, by, bw, bh)
            # Shadow layer (dark mode only)
            if T.dark:
                shadow_r = pygame.Rect(bx+2, by+4, bw, bh)
                draw_rrect(surf, (8, 10, 18), shadow_r, r=16)
            draw_rrect(surf, fill, btn_r, r=16)
            # Subtle bottom-edge highlight
            hi_r = pygame.Rect(bx+2, by+bh-6, bw-4, 4)
            hi_col = lerp(fill, (0,0,0), 0.25)
            pygame.draw.rect(surf, hi_col, hi_r, border_radius=4)
            draw_text(surf, label, F["med"], txt_col, bx + bw//2, by + bh//2)

        # Hint line below buttons
        draw_text(surf, "A — position match   ·   L — letter match   ·   Esc — quit",
                  F["label"], T.text_faint, W//2, by + bh + 16)

        # ── Score pills ───────────────────────────────────────────────────────
        strip_y = H - 28
        pos_score = self.pos_hits - self.pos_fa
        let_score = self.let_hits - self.let_fa
        pos_sc_col = T.hit if pos_score >= 0 else T.miss
        let_sc_col = T.hit if let_score >= 0 else T.miss

        for (label, hits, misses, fa, sc, sc_col, px) in [
            ("Position", self.pos_hits, self.pos_misses, self.pos_fa, pos_score, pos_sc_col, W//4),
            ("Letter",   self.let_hits, self.let_misses, self.let_fa, let_score, let_sc_col, 3*W//4),
        ]:
            pill = pygame.Rect(px - 180, strip_y - 12, 360, 26)
            draw_rrect(surf, T.pill_bg, pill, r=13)
            draw_text(surf,
                      f"{label}  {hits}h {misses}m {fa}fa  {sc:+d}",
                      F["label"], T.text_dim, px, strip_y)

        # ── Progress bar ──────────────────────────────────────────────────────
        bw2, bh2 = W - 80, 5
        bx2, by2 = 40, H - 10
        frac = self.step / max(1, self.total_steps - 1)
        draw_rrect(surf, T.progress_bg, pygame.Rect(bx2, by2, bw2, bh2), r=3)
        if frac > 0:
            draw_rrect(surf, T.accent_pos,
                       pygame.Rect(bx2, by2, int(bw2*frac), bh2), r=3)

    # ── Run loop ──────────────────────────────────────────────────────────────

    def run(self, surf, clock):
        self.start_trial()
        next_trial_at = time.time() + TRIAL_INTERVAL

        while not self.done and not self.quit:
            for ev in pygame.event.get():
                if ev.type == pygame.QUIT:
                    self.quit = True
                elif ev.type == pygame.KEYDOWN:
                    self.handle_key(ev.key)

            now = time.time()
            if self.stim_active and now - self.stim_start >= STIM_DURATION:
                self.stim_active = False
            if now >= next_trial_at:
                self.score_trial()
                self.advance()
                if not self.done:
                    next_trial_at = now + TRIAL_INTERVAL

            self.draw(surf)
            pygame.display.flip()
            clock.tick(FPS)


# ── Results screen ─────────────────────────────────────────────────────────────

def draw_results(surf, game, T, F):
    surf.fill(T.bg)

    draw_text(surf, f"{game.n}-Back  —  Results", F["big"], T.text, W//2, 58)

    for i, (label, hits, misses, fa, cr, base_col) in enumerate([
        ("Position", game.pos_hits, game.pos_misses, game.pos_fa, game.pos_cr, T.accent_pos),
        ("Letter",   game.let_hits, game.let_misses, game.let_fa, game.let_cr, T.accent_let),
    ]):
        px   = W//4 + i*W//2
        py   = 108
        pw, ph = 330, 310
        panel = pygame.Rect(px - pw//2, py, pw, ph)
        draw_rrect(surf, T.surface, panel, r=20)
        draw_rrect(surf, T.bg, panel, r=20, width=1, border_col=T.border)

        # Coloured top stripe
        stripe = pygame.Rect(px - pw//2, py, pw, 6)
        pygame.draw.rect(surf, base_col, stripe,
                         border_top_left_radius=20, border_top_right_radius=20)

        draw_text(surf, label, F["med"], base_col, px, py + 38)

        score = hits - fa
        acc   = accuracy(hits, misses, fa, cr)
        rows  = [
            ("Hits",          f"{hits}",     T.hit  if hits  > 0 else T.text_dim),
            ("Misses",        f"{misses}",   T.miss if misses> 0 else T.text_dim),
            ("False alarms",  f"{fa}",       T.miss if fa    > 0 else T.text_dim),
            ("Accuracy",      f"{acc:.0f}%", T.text),
        ]
        for j, (k, v, vc) in enumerate(rows):
            ty = py + 88 + j*48
            # Divider
            pygame.draw.line(surf, T.border,
                             (px-pw//2+20, ty-14), (px+pw//2-20, ty-14))
            draw_text(surf, k, F["small"], T.text_dim, px-20, ty, "midright")
            draw_text(surf, v, F["med"],   vc,         px-10, ty, "midleft")

        sc_col = T.hit if score >= 0 else T.miss
        draw_text(surf, f"Score  {score:+d}", F["med"], sc_col, px, py + ph - 36)

    total = (game.pos_hits-game.pos_fa) + (game.let_hits-game.let_fa)
    tc    = T.hit if total >= 0 else T.miss
    draw_text(surf, f"Combined  {total:+d}", F["big"], tc, W//2, 468)

    # Mode toggle hint  +  restart
    draw_text(surf, "Space — play again   ·   T — toggle theme   ·   Esc — quit",
              F["small"], T.text_dim, W//2, 530)


# ── Menu screen ────────────────────────────────────────────────────────────────

def draw_menu(surf, n, trials, T, F, audio_ok):
    surf.fill(T.bg)

    # Title
    draw_text(surf, "Dual N-Back", F["big"], T.text, W//2, 72)
    draw_text(surf, "Two streams. One focus.",
              F["small"], T.text_dim, W//2, 112)

    # ── Settings panel ────────────────────────────────────────────────────────
    panel = pygame.Rect(W//2-270, 140, 540, 180)
    draw_rrect(surf, T.surface, panel, r=20)
    draw_rrect(surf, T.bg, panel, r=20, width=1, border_col=T.border)

    # N row
    row1y = 190
    draw_text(surf, "N", F["med"], T.text_dim, W//2-140, row1y)
    # Decrease / value / increase
    for dx, sym, col in [(-52, "<", T.text_dim), (0, str(n), T.accent_pos), (52, ">", T.text_dim)]:
        draw_text(surf, sym, F["med"], col, W//2+dx, row1y)
    draw_text(surf, "↑ / ↓", F["label"], T.text_faint, W//2+130, row1y)

    pygame.draw.line(surf, T.border, (W//2-230, 215), (W//2+230, 215))

    # Trials row
    row2y = 248
    draw_text(surf, "Trials", F["med"], T.text_dim, W//2-140, row2y)
    for dx, sym, col in [(-52, "<", T.text_dim), (0, str(trials), T.text), (52, ">", T.text_dim)]:
        draw_text(surf, sym, F["med"], col, W//2+dx, row2y)
    draw_text(surf, "[ / ]", F["label"], T.text_faint, W//2+130, row2y)

    # Audio status row
    pygame.draw.line(surf, T.border, (W//2-230, 272), (W//2+230, 272))
    row3y = 293
    a_col = T.hit if audio_ok else T.miss
    a_txt = "Audio  ON" if audio_ok else "Audio  OFF"
    draw_text(surf, a_txt, F["small"], a_col, W//2, row3y)

    # ── How to play ───────────────────────────────────────────────────────────
    guide = pygame.Rect(W//2-270, 342, 540, 196)
    draw_rrect(surf, T.surface, guide, r=20)
    draw_rrect(surf, T.bg, guide, r=20, width=1, border_col=T.border)

    rules = [
        (T.accent_pos, "A",  "when the grid position matches N steps ago"),
        (T.accent_let, "L",  "when the letter / tone matches N steps ago"),
        (T.text_dim,   "+",  "both keys can be pressed on the same trial"),
        (T.text_faint, "—",  "first N trials are warm-up, no scoring yet"),
    ]
    for k, (col, key, desc) in enumerate(rules):
        ty = 376 + k*40
        # Key badge
        badge = pygame.Rect(W//2-236, ty-14, 30, 28)
        draw_rrect(surf, T.surface2, badge, r=7)
        draw_text(surf, key, F["small"], col, W//2-221, ty)
        draw_text(surf, desc, F["small"], T.text_dim, W//2-30, ty, "midleft")

    # ── Bottom controls ───────────────────────────────────────────────────────
    draw_text(surf, "Space — start   ·   T — toggle theme   ·   Esc — quit",
              F["small"], T.text_faint, W//2, 572)

    # Big start cue
    draw_text(surf, "Press  Space  to begin", F["med"], T.accent_pos, W//2, 624)


# ── Main ───────────────────────────────────────────────────────────────────────

def main():
    pygame.mixer.pre_init(SAMPLE_RATE, -16, 2, 1024)
    pygame.init()

    audio_ok = False
    try:
        pygame.mixer.init()
        audio_ok = True
    except Exception:
        pass

    surf  = pygame.display.set_mode((W, H))
    pygame.display.set_caption("Dual N-Back")
    clock = pygame.time.Clock()

    F     = load_fonts()
    dark  = True
    T     = Theme(dark)

    print("Loading sounds…" if audio_ok else "No audio device — running silent.")
    sounds = build_sounds(audio_ok)

    n      = 2
    trials = TRIALS_BASE
    state  = "menu"
    game   = None

    while True:
        for ev in pygame.event.get():
            if ev.type == pygame.QUIT:
                pygame.quit(); sys.exit()
            elif ev.type == pygame.KEYDOWN:
                k = ev.key
                if k == pygame.K_t:          # theme toggle — works everywhere
                    dark = not dark
                    T    = Theme(dark)
                    if game:
                        game.theme = T

                if state == "menu":
                    if k == pygame.K_SPACE:
                        state = "game"
                        game  = DualNBack(n, trials, audio_ok, sounds, T, F)
                    elif k in (pygame.K_UP,   pygame.K_RIGHT):       n = min(n+1, 20)
                    elif k in (pygame.K_DOWN, pygame.K_LEFT):        n = max(n-1, 1)
                    elif k == pygame.K_RIGHTBRACKET:   trials = min(trials+5, 60)
                    elif k == pygame.K_LEFTBRACKET:    trials = max(trials-5, 10)
                    elif k == pygame.K_ESCAPE:
                        pygame.quit(); sys.exit()

                elif state == "results":
                    if k == pygame.K_SPACE:   state = "menu"
                    elif k == pygame.K_ESCAPE:
                        pygame.quit(); sys.exit()

        if state == "menu":
            draw_menu(surf, n, trials, T, F, audio_ok)
            pygame.display.flip()
            clock.tick(FPS)

        elif state == "game":
            game.run(surf, clock)
            if game.quit:
                pygame.quit(); sys.exit()
            state = "results"

        elif state == "results":
            draw_results(surf, game, T, F)
            pygame.display.flip()
            clock.tick(FPS)


if __name__ == "__main__":
    main()