# Gmail OAuth2 untuk email OTP dan reset password

OTP dibuat dan diverifikasi oleh backend. Google OAuth2 memberi backend izin untuk mengirim email dari akun `GMAIL_USER` melalui Gmail SMTP; ini bukan login Google untuk pelanggan.

## Konfigurasi Google Cloud dan Playground

1. Pilih proyek Google Cloud yang memiliki OAuth Client sesuai `GMAIL_CLIENT_ID` backend.
2. Buka **Google Auth Platform → Clients** (atau **APIs & Services → Credentials**), pilih client bertipe **Web application**.
3. Pada **Authorized redirect URIs**, tambahkan persis `https://developers.google.com/oauthplayground`. Jangan menaruhnya pada JavaScript origins, dan jangan menambahkan slash di akhir. Simpan perubahan.
4. Pada **Audience**, gunakan **External / Testing** untuk pengujian akun pribadi; tambahkan alamat akun pengirim sebagai **Test user**. Jika memakai Workspace dengan aplikasi Internal, akun harus termasuk organisasi yang diizinkan.
5. Buka https://developers.google.com/oauthplayground/ di browser biasa. Di pengaturan roda gigi, aktifkan **Use your own OAuth credentials**, gunakan Client ID/Secret dari client yang sama. Pilih flow server-side, access type **Offline**, dan prompt **Consent Screen**.
6. Untuk transporter Nodemailer SMTP pada proyek ini, minta scope `https://mail.google.com/`. Scope `gmail.send` saja ditujukan ke Gmail API dan tidak cukup untuk SMTP ini.
7. Klik **Authorize APIs**, masuk menggunakan akun yang sama dengan `GMAIL_USER`, lalu setujui izin aplikasi milik sendiri. Klik **Exchange authorization code for tokens**.
8. Simpan nilai **refresh_token** pada `GMAIL_REFRESH_TOKEN` di `.env` backend. Jangan menyalin authorization code atau access token ke field ini.
9. Setelah token diverifikasi, ubah `EMAIL_DRIVER=gmail` lalu restart backend. Saat `EMAIL_DRIVER=console`, email hanya ditulis ke log development dan tidak dikirim ke inbox.

Client ID, Client Secret, refresh token dan akun pengirim harus berasal dari alur/proyek yang sama. Jangan menambahkan secret backend ke environment publik frontend atau mengirimkannya melalui chat.

## Error yang relevan

| Error                        | Pemeriksaan                                                                                                                                                                                                                                                                        |
| ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `redirect_uri_mismatch`      | Redirect URI harus cocok persis dengan permintaan; untuk Playground gunakan URL pada langkah 3 dan client Web application yang sama.                                                                                                                                               |
| `access_denied` saat Testing | Google Auth Platform → Audience → Test users → Add users. Tambahkan akun Google pengirim sesuai GMAIL_USER, simpan, lalu ulang Authorize APIs dengan akun yang sama. Pastikan proyeknya sama dengan OAuth Client pada Playground; kebijakan organisasi juga dapat membatasi akses. |
| `org_internal`               | Akun berada di luar organisasi Google Cloud yang diizinkan.                                                                                                                                                                                                                        |
| `invalid_grant` saat refresh | Token tidak diterima: dapat salah, kedaluwarsa, dicabut, atau tidak cocok dengan client. Otorisasi ulang dengan konfigurasi yang benar.                                                                                                                                            |

Untuk aplikasi External berstatus Testing yang meminta scope Gmail, persetujuan dan refresh token biasanya berlaku tujuh hari. Untuk operasional jangka panjang, rencanakan status/verifikasi aplikasi sesuai kebijakan Google; mengganti status tidak otomatis menyelesaikan verifikasi atau kebijakan Workspace.

## Status pemeriksaan lokal 18 November 2026

Driver masih `console`. Pemeriksaan token yang saat ini terisi menghasilkan HTTP 400 `invalid_grant`; tidak ada email nyata dikirim. Error Playground yang dilaporkan pengguna adalah HTTP 400 `redirect_uri_mismatch`, sehingga redirect URI pada client perlu diperbaiki sebelum membuat token baru. Jangan mengaktifkan driver Gmail dengan token tersebut.

## Rujukan

- [Pengaturan resmi OAuth Playground](https://developers.google.com/oauthplayground/)
- [Google: OAuth web-server dan redirect URI](https://developers.google.com/identity/protocols/oauth2/web-server)
- [Google: Audience dan masa berlaku saat Testing](https://support.google.com/cloud/answer/15549945?hl=en)
- [Nodemailer: OAuth2 dan scope SMTP Gmail](https://nodemailer.com/smtp/oauth2)
