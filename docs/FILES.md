# TALLERO AUTO — PENGELOLAAN BERKAS PRIVAT & SIGNED URL (FILES.md)

Dokumen ini menjelaskan tata cara pengunggahan berkas gambar (avatar profil dan foto inspeksi pengerjaan), mekanisme pengamanan berkas privat menggunakan Signed URL, serta penanganan unduhan berkas blob pada **Tallero Auto**.

---

## 1. Spesifikasi & Standar Pengunggahan Berkas

Sesuai aturan keamanan **AGENTS.md §4.18**:
1. Seluruh berkas yang diunggah disimpan di dalam direktori privat terisolasi: `storage/private/` (di luar jangkauan publik server web, dilindungi dari *path traversal*).
2. Nama berkas asli dari pengguna **tidak pernah digunakan** di server. Berkas disimpan dengan penamaan acak UUID v4: `<uuid>.webp`.
3. Pemeriksaan tipe berkas tidak hanya bergantung pada ekstensi berkas, melainkan melalui inspeksi *magic bytes* header berkas via pustaka `file-type`.
4. Berkas gambar otomatis diproses ulang menggunakan `sharp`:
   - Dikonversi menjadi format **WebP** terkompresi.
   - Sisi terpanjang di-*resize* maksimal **1920 px** (`MAX_IMAGE_DIMENSION_PX`).
   - Seluruh metadata sensitif kamera (EXIF, tanggal pengambilan, dan koordinat GPS) dihapus secara permanen.

---

## 2. Rincian Endpoint Pengunggahan

### 2.1. Unggah Avatar Profil Pengguna (`POST /api/v1/auth/me/avatar`)
- **Role**: `AUTH` (Pengguna yang sedang login).
- **Content-Type**: `multipart/form-data`.
- **Field Nama**: `file`.
- **Batasan**: Format JPG/PNG/WebP, maksimal **5 MB** (`MAX_FILE_SIZE_BYTES`).
- **Contoh Request (JavaScript FormData)**:
  ```javascript
  const formData = new FormData();
  formData.append('file', imageFile);

  const res = await api.post('/auth/me/avatar', formData, {
    headers: { 'Content-Type': 'multipart/form-data' }
  });
  ```

---

### 2.2. Unggah Foto Inspeksi Bengkel (`POST /api/v1/bookings/:id/photos`)
- **Role**: `STAFF` (Mekanik penangan atau Admin).
- **Content-Type**: `multipart/form-data`.
- **Fields**:
  | Field | Tipe | Wajib | Keterangan |
  |:---|:---|:---|:---|
  | `file` | File Binary | Wajib | Berkas foto inspeksi (maks 5 MB). |
  | `type` | String | Wajib | Enum: `BEFORE` (sebelum servis) atau `AFTER` (setelah servis). |
  | `caption` | String | Opsional | Catatan penjelasan kondisi komponen (maks 255 karakter). |
- **Batasan Kuota**: Maksimal **10 foto** untuk tipe `BEFORE` dan maksimal **10 foto** untuk tipe `AFTER` per booking (`MAX_PHOTOS_PER_TYPE = 10`).

---

## 3. Mekanisme Akses Berkas Privat (Signed URL)

Karena berkas berada di folder privat, klien tidak dapat mengakses gambar melalui URL statis biasa. Akses diberikan melalui **Signed URL berumur pendek**.

### 3.1. Struktur Parameter Signed URL
URL gambar yang dikembalikan oleh backend memiliki parameter otentikasi:
`/api/v1/files/:kind/:id?exp=1763630600&sig=a1b2c3d4e5f6...`

- `:kind`: Kategori berkas (`avatar` atau `booking-photo`).
- `:id`: ID entitas pemilik berkas.
- `exp`: Timestamp Unix waktu kedaluwarsa URL.
- `sig`: Tanda tangan kriptografis HMAC-SHA256 yang memvalidasi keaslian parameter.
- **Masa Berlaku URL**: **10 menit** (`SIGNED_URL_TTL_SEC = 600` detik).

---

### 3.2. Strategi Penanganan Signed URL Kedaluwarsa di Klien

Jika gambar gagal dimuat di browser atau aplikasi mobile (server merespons **HTTP 401 INVALID_SIGNATURE** atau **SIGNATURE_EXPIRED**):

```javascript
// Komponen gambar dengan kemampuan auto-refresh URL jika kedaluwarsa
import React, { useState } from 'react';

export function SecureImage({ initialUrl, onRefreshUrl, alt, ...props }) {
  const [src, setSrc] = useState(initialUrl);

  const handleError = async () => {
    try {
      // Panggil fungsi untuk mengambil signed URL segar dari data parent
      const freshUrl = await onRefreshUrl();
      setSrc(freshUrl);
    } catch (err) {
      console.error("Gagal memperbarui signed URL", err);
    }
  };

  return <img src={src} alt={alt} onError={handleError} {...props} />;
}
```

---

## 4. Unduhan Berkas Blob & Ekspor Dokumen

Pada saat mengunduh faktur PDF (`/bookings/:id/invoice.pdf`) atau laporan ekspor Excel/CSV (`/admin/reports/export`), server menyertakan header standar HTTP `Content-Disposition`.

### 4.1. Header Respons Server
```http
HTTP/1.1 200 OK
Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Content-Disposition: attachment; filename="laporan-operasional-202611.xlsx"
```

### 4.2. Penanganan Ekspor di Klien Web (Ekstraksi Nama Berkas Asli)
```javascript
export async function downloadReportFile(exportType, format, from, to) {
  const response = await api.get('/admin/reports/export', {
    params: { type: exportType, format, from, to },
    responseType: 'blob'
  });

  // 1. Ekstrak nama berkas dari header Content-Disposition
  const disposition = response.headers['content-disposition'];
  let filename = `laporan-${exportType}.${format}`;
  if (disposition && disposition.includes('filename=')) {
    filename = disposition.split('filename=')[1].replace(/"/g, '').trim();
  }

  // 2. Buat URL Blob dan trigger unduhan peramban
  const blob = new Blob([response.data], { type: response.headers['content-type'] });
  const downloadUrl = window.URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = downloadUrl;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.URL.revokeObjectURL(downloadUrl);
}
```

