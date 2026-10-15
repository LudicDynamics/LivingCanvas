---
type: readme
name: 村广场
bg: assets/scenes/square.webp
title: 村广场
intent: 岛民傍晚爱在这里坐坐；周日上午有集市，节日（灯笼祭、秋收晚宴）也在这里办。陪澪玩走
  command/play-with-mio.yaml；听海弹琴走
  command/listen-kai.yaml（海上岸之前他不在这儿，这个选项就只是你一个人坐了一会儿）。
choice:
  options:
    - id: play-mio
      label: 陪澪玩一会儿
    - id: listen-kai
      label: 在树荫下坐一会儿，听有没有人弹琴
  allow_free: true
on:
  choice_selected:
    - when: choice.option_id == "play-mio"
      run: play-with-mio
      on_error: continue
    - when: choice.option_id == "listen-kai"
      run: listen-kai
      on_error: continue
---

一棵老樟树撑开一片荫凉，树下有两张长椅和一口不再用的井。石板路从这里分出去，一条通码头，一条上灯塔。

晚上，花店门口的灯一亮，大家就慢慢聚过来。
