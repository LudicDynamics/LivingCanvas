---
type: ending
title: 列车开走了
bg: assets/scenes/ending-departed.webp
passages:
  - when: 'player.hp <= 0'
    text: 你是被夏澄扶着下的车。从隧道到岭口那二十五分钟，你一直靠在18号的车窗边，手里攥着这一夜找到的东西，没能再站起来。
  - group: su-he
    when: 'has("player/su-he-testimony.md")'
    text: 苏禾是你们从行李车的邮袋堆里扶出来的，裹着夏澄的棉大衣，人活了下来。可那通电话一直没有打出去，她说的话，只有你们几个人听见。
  - group: su-he
    text: 到站以后，乘务员才在行李车的邮袋堆里发现了苏禾。她被送去了医院，人活了下来，可那一夜的事，她只记得一杯很苦的茶。
  - group: log
    when: 'has("player/logbook-page.md") || has("world/freight-car/logbook-page.md")'
    text: 那页日志还在你手里。可它错过了今晚那通电话，还要再走很长一段路，才能到该看它的人面前。
  - group: log
    when: 'has("player/torn-corner.md") || has("world/freight-car/torn-corner.md")'
    text: 日志页进了炉膛，只剩你手里烧焦的一角。十二年前的那盏红灯，还是记在苏长庚一个人的名下。
  - group: log
    text: 日志页再也没有找到。十二年前的那盏红灯，还是记在苏长庚一个人的名下。
---

五点整，车身一震，末班车驶出了断云隧道。二十五分钟后到了岭口，分局的车已经等在站台，钟怀礼提着手提箱第一个下了车。
