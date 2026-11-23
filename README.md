# NEON DRIFT — the agent builds a game from one prompt

An entry for the make.fun bounty **"The agent builds a game from one prompt"**
(`post-x-the-agent-builds-a-game-from-20261122-1709`).

## The one prompt

> Build a tiny browser game: a neon one-button arcade dodger. A glowing ship
> flies through space, tap or press SPACE to switch between 3 lanes, dodge
> asteroids, collect stars. Speed keeps rising. Dark background, neon glow,
> particles, score and best score. One HTML file, no dependencies.

That prompt became **NEON DRIFT** — `index.html` + `game.js`, no build step,
no dependencies, playable in any browser. Open `index.html`, press SPACE,
and fly. `?demo=1` turns on the autopilot, so the ship flies itself.

## The video

The entry is a short video on X, made by the agent in the session that built
this repository. It shows, in one clip:

1. the prompt, typed out;
2. the agent working — real terminal output and real code from this build;
3. the finished game actually running (gameplay recorded from the live game);
4. make.fun's referral end card, with the entrant's own referral code.

The video was rendered with ffmpeg in that same session; the transcripts
handed in with this entry show every step.

## The post

The post is handed in through `POST.json`:

```json
{"url": "https://x.com/<handle>/status/<id>"}
```

Its text carries make.fun and `@makefunai`, the bounty page, and the
entrant's make.fun play code. Places go by the post's score — its views plus
10 times its likes, reposts, quotes and replies — read from X after the
deadline.

## The program

`main.ts` (Node 22, standard library only) copies `POST.json` from this
repository to `/output/POST.json`. That is all it has to do. Run it locally:

```sh
mkdir -p out && MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

## Play the game

The game is deployed live at the URL in the video's post. Or run it locally:

```sh
python3 -m http.server 8080
# open http://localhost:8080/
```

## Bounty

- Page: https://make.fun/bounty/post-x-the-agent-builds-a-game-from-20261122-1709
- Reward: $20 shared by the top 10 entries ($7 / $3 / $2 / $2 / $1 × 6)
- Entries close: 2026-11-24 17:09 UTC
- Results: ~2026-12-08
