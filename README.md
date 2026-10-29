# UNO Onlayn

Do'stlar bilan 2–6 kishi bo'lib o'ynaladigan onlayn UNO o'yini (Node.js + Express + Socket.IO).

## Ishga tushirish

```bash
npm install
npm start
```

Brauzerda oching: http://localhost:3000

## Qanday o'ynaladi

1. Bir kishi **Xona yaratish** bo'limida ismi va parolni kiritadi.
2. Kutish xonasida **Nusxa olish** tugmasi havola, xona kodi va parolni nusxalaydi. Shuni do'stlarga yuboring.
3. Do'stlar havolani ochadi (xona kodi o'zi yoziladi), ism va parolni kiritib kiradi.
4. Kamida 2 kishi yig'ilgach, xona egasi **O'yinni boshlash** tugmasini bosadi.

## Qoidalar

- 108 ta karta, har kimga 7 tadan beriladi.
- Rangi yoki qiymati mos kartani tashlaysiz. "Rang tanlash" va "+4" kartalarini istalgan vaqtda tashlash mumkin.
- Mos karta bo'lmasa, kolodadan 1 ta oling. Olgan karta mos kelsa, uni tashlashingiz yoki **O'tkazish**ni bosishingiz mumkin.
- ⊘ keyingi o'yinchini o'tkazib yuboradi, ⇄ yo'nalishni o'zgartiradi (2 kishida ⊘ kabi ishlaydi), +2 / +4 keyingi o'yinchiga karta beradi va uning navbati o'tadi.
- 2 ta karta qolganda (yoki oxirgi kartani tashlagandan so'ng darhol) **UNO!** tugmasini bosing. Bosmasangiz, boshqa o'yinchi "Ushlash"ni bosadi va siz 2 ta karta olasiz.
- Birinchi bo'lib kartalari tugagan o'yinchi yutadi.

## Qo'shimcha

- Sahifa yangilansa yoki internet uzilsa, o'yinchi avtomatik qaytib kiradi va kartalari saqlanib qoladi.
- Uzilib qolgan o'yinchining navbati o'tkazib yuboriladi.
- Xona egasi kutish xonasida o'yinchilarni chiqarishi mumkin.
- Xonalar server xotirasida saqlanadi. Server qayta ishga tushsa, xonalar o'chadi.

## Internetga joylash

Do'stlar sizning kompyuteringizdagi `localhost`ga kira olmaydi, shuning uchun serverni internetga joylash kerak. Masalan, [Render](https://render.com) yoki [Railway](https://railway.app) da Node.js servis sifatida:

- Build buyrug'i: `npm install`
- Start buyrug'i: `npm start`

Server `PORT` muhit o'zgaruvchisini avtomatik ishlatadi.

Tezroq sinab ko'rish uchun kompyuteringizda `npm start`ni ishga tushirib, [ngrok](https://ngrok.com) bilan ulashsa ham bo'ladi: `ngrok http 3000`.
