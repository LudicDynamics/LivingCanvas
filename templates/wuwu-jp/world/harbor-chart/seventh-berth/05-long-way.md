---
type: chalk
title: 遠回り・銀鳶の面前で船倉を開けてもらう
status:
  data:
    open: no
    done: no
choice:
  options:
    - id: long-way
      label: 銀鳶の面前で船倉を開けてもらい、一緒に点検する（潮水を余分に一段消費）
      when: open == "yes" && done != "yes"
on:
  choice_selected:
    - when: choice.option_id == "long-way"
      run: evidence-decoy
      on_error: continue
    - when: choice.option_id == "long-way"
      run: long-way-berth
      on_error: continue
---

この道は7番埠頭の調査サイコロで調べ切れなかった（61–100）後にだけ開く。

堂々と銀鳶を訪ねる：擦り傷の記録を出し、なぜ船倉を見たいのかをはっきり話す——先ほど彼に見つかっていたなら、まず話をつける。彼は代わりに結論を下したりはしないが、あなたの面前で艙蓋をこじ開ける：バラスト石、打ち付けられた空箱。

これでも7番埠頭の糸を留められるが、潮水を余分に一段（十数分）消費する。糸が留まれば、ここにはもう来なくてよい。
