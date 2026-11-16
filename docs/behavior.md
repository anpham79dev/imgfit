# imgfit — hành vi xử lý ảnh

Tài liệu này mô tả imgfit làm gì với từng ảnh. Mỗi quy tắc có test chạy trên bộ ảnh mẫu (`test/behavior/`). Bộ ảnh mẫu được tạo bằng [scripts/samples.mjs](../scripts/samples.mjs), không dùng ảnh có bản quyền.

## 1. Quy tắc

| # | Quy tắc | Tùy chọn |
|---|---|---|
| R1 | Fit trong khung W×H, giữ tỉ lệ, **cả hai chiều** đều ≤ khung | `mode: "fit"` |
| R2 | Không phóng to ảnh nhỏ (mặc định) | `upscale: false` |
| R3 | Xoay theo EXIF orientation, rồi xóa tag orientation | luôn bật |
| R4 | Ảnh trong suốt xuất JPG: làm phẳng trên nền **trắng**, kèm cảnh báo `W_ALPHA_FLATTENED` | `background` để đổi màu nền |
| R5 | Bỏ metadata (EXIF, GPS, XMP, ICC), chuyển sRGB, kể cả JPEG CMYK | `stripMetadata: false` để giữ (kèm `W_METADATA_KEPT`) |
| R6 | Định dạng input xác định theo **nội dung** file, không theo đuôi | |
| R7 | Mỗi output resize **từ ảnh gốc**, không resize bản nhỏ từ bản lớn | |
| R8 | Không bao giờ ghi đè ảnh gốc, kể cả khi bật ghi đè | `E_OUTPUT_SAME_AS_SOURCE` |
| R9 | Xuất JPG, PNG, WebP hoặc AVIF theo từng preset | `format` |
| R10 | Cùng một engine (libvips qua sharp) trên mọi máy | |

## 2. So sánh với Intervention Image và imgproxy

Chạy lại: `npm run build && node scripts/compare/compare.mjs && node scripts/compare/report.mjs`. Intervention và imgproxy chạy trong Docker, chỉ phục vụ so sánh.

- **Intervention**: `intervention/image` 2.7.2, driver GD, PHP 8.3. Mã giống cách viết tay phổ biến: ảnh ngang (`w > h`) resize theo chiều rộng, còn lại theo chiều cao, `aspectRatio()`, lưu `.jpg`. Biến thể `no-enlarge` có thêm `upsize()` (trong v2, `upsize()` nghĩa là *không* phóng to).
- **imgproxy**: `darthsim/imgproxy:v3.30.1`, `rs:fit:W:H:0` (không phóng to).
- **imgfit**: `resize --mode fit`.
- Preset: `L` 640×480, `LL` 1600×1200. Bộ mẫu 21 ảnh (`scripts/samples.mjs`, có ảnh 54 MP).
- **PSNR** đo độ lệch giữa output và bản resize lanczos3 không nén có cùng kích thước. PSNR càng cao càng ít mất mát do nén và resample. Chỉ nên so trong cùng một preset.

Máy đo: Intel Core 5 210H · Windows 11 · Node 24.16 · sharp 0.35.5 · libvips 8.18.7.

### 2.1. Tổng hợp

| Công cụ | Biến thể | Preset | Ảnh | Tổng dung lượng | PSNR TB (dB) | ms/ảnh TB | Vượt khung | Phóng to | Còn GPS | Lỗi |
|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|
| imgfit | jpg-q80 | L | 21 | 496 KB | 33,67 | 46 | 0 | 0 | 0 | 0 |
| imgfit | jpg-q85 | L | 21 | 629 KB | 34,04 | 47 | 0 | 0 | 0 | 0 |
| imgfit | webp (q82) | L | 21 | 418 KB | 33,96 | 63 | 0 | 0 | 0 | 0 |
| imgfit | avif (q50) | L | 21 | 219 KB | 36,20 | 156 | 0 | 0 | 0 | 0 |
| imgproxy | q80 | L | 21 | 498 KB | 33,51 | 50 | 0 | 0 | 0 | 0 |
| imgproxy | webp (mặc định) | L | 21 | 335 KB | 33,51 | 57 | 0 | 0 | 0 | 0 |
| intervention | q100 | L | 20 | 3.475 KB | 34,43 | 462 | 1 | 1 | 0 | 1 |
| intervention | q90 (mặc định v2) | L | 20 | 913 KB | 33,36 | 532 | 1 | 1 | 0 | 1 |
| intervention | q80 | L | 20 | 555 KB | 32,86 | 415 | 1 | 1 | 0 | 1 |
| intervention | q80 + upsize() | L | 20 | 514 KB | 32,80 | 557 | 1 | 0 | 0 | 1 |
| imgfit | jpg-q80 | LL | 21 | 2.598 KB | 33,99 | 67 | 0 | 0 | 0 | 0 |
| imgfit | jpg-q85 | LL | 21 | 3.367 KB | 34,14 | 71 | 0 | 0 | 0 | 0 |
| imgfit | webp (q82) | LL | 21 | 2.650 KB | 33,60 | 149 | 0 | 0 | 0 | 0 |
| imgfit | avif (q50) | LL | 21 | 963 KB | 33,62 | 434 | 0 | 0 | 0 | 0 |
| imgproxy | q80 | LL | 21 | 2.591 KB | 33,89 | 63 | 0 | 0 | 0 | 0 |
| imgproxy | webp (mặc định) | LL | 21 | 2.173 KB | 33,01 | 138 | 0 | 0 | 0 | 0 |
| intervention | q100 | LL | 20 | 22.852 KB | 35,21 | 496 | 1 | 7 | 0 | 1 |
| intervention | q90 (mặc định v2) | LL | 20 | 6.814 KB | 33,55 | 503 | 1 | 7 | 0 | 1 |
| intervention | q80 | LL | 20 | 4.012 KB | 32,98 | 437 | 1 | 7 | 0 | 1 |
| intervention | q80 + upsize() | LL | 20 | 2.896 KB | 32,80 | 414 | 1 | 0 | 0 | 1 |

"ms/ảnh" của Intervention gồm cả decode bằng GD trong PHP. Của imgproxy là thời gian một request HTTP. Của imgfit là thời gian xử lý trong process (không tính khởi động Node).

### 2.2. Các trường hợp đáng chú ý

| Ảnh | Preset | Công cụ | Output | Dung lượng | PSNR |
|---|---|---|---|---:|---:|
| ngang gần vuông 2000×1900 | LL | Intervention q80 | 1600×1520 **vượt khung** | 319 KB | 33,21 |
| | | imgproxy q80 | 1263×1200 | 168 KB | 34,22 |
| | | imgfit q80 | 1263×1200 | 168 KB | 34,24 |
| nhỏ 300×200 (30 KB) | LL | Intervention q80 | 1600×1067 **phóng to** | 232 KB | 32,85 |
| | | imgproxy q80 | 300×200 | 15 KB | 29,28 |
| | | imgfit q80 | 300×200 | 14 KB | 29,28 |
| PNG trong suốt 1200×800 | L | Intervention q80 | 640×427, nền trắng | 29 KB | 28,72 |
| | | imgproxy q80 | 640×427, nền trắng | 28 KB | 32,32 |
| | | imgfit q80 | 640×427, nền trắng | 28 KB | 32,48 |
| JPEG CMYK 2400×1600 | L | Intervention q80 | 640×427, **sai màu** | 40 KB | 22,74 |
| | | imgproxy q80 | 640×427 | 23 KB | 30,46 |
| | | imgfit q80 | 640×427 | 23 KB | 33,13 |
| JPG đã nén sẵn 640×480 (27 KB) | L | Intervention q80 | 640×480 | 44 KB | 42,13 |
| | | imgproxy q80 | 640×480 | 36 KB | 42,13 |
| | | imgfit q80 | 640×480, **nặng hơn ảnh vào** | 36 KB | 42,13 |

### 2.3. Kết luận

Các lỗi ở mục 3.1 của kế hoạch, kiểm chứng trên bộ mẫu:

| Lỗi | Kết quả |
|---|---|
| Ảnh ngang gần vuông vượt khung | **Xác nhận**: 2000×1900 → 1600×1520 (LL), 640×608 (L) |
| Không `upsize()` thì phóng to ảnh nhỏ | **Xác nhận**: 7/20 ảnh bị phóng to ở LL, dung lượng tăng 39% (4.012 KB so với 2.896 KB) |
| Quality 100 làm file rất nặng | **Xác nhận**: q100 nặng gấp **5,7–6,3 lần** q80, PSNR chỉ tăng 1,6–2,2 dB |
| PNG trong suốt sang JPG ra nền đen | **Không tái hiện với GD**: Intervention v2 + GD cho nền trắng. Lỗi phụ thuộc driver, chưa thử Imagick |
| Kết quả khác nhau giữa các driver | Chưa đo Imagick. GD **không đọc được TIFF** và **sai màu với JPEG CMYK** |
| imgfit so với imgproxy | Ngang nhau với JPG q80: dung lượng bằng nhau (496/498 KB ở L), PSNR imgfit cao hơn 0,1–0,2 dB, CMYK tốt hơn rõ |
| Output nặng hơn input | **Xác nhận**: JPG 640×480 đã nén q55 (27 KB) ra 36 KB với q80, ở cả imgfit và imgproxy. Đây là lý do cần `keepSmallerSource` |

Định dạng và quality:

- **JPG q80 so với q85**: q80 nhẹ hơn 21–23%, PSNR thấp hơn 0,15–0,4 dB. Đổi mặc định sang 80 (giống imgproxy).
- **WebP q82 (mặc định hiện tại)**: nhẹ hơn JPG q80 16% ở L, nhưng **nặng hơn 2%** ở LL. imgproxy WebP (q80) nhẹ hơn imgfit WebP 18–20%.
- **AVIF q50**: nhẹ nhất (L: −56%, LL: −63% so với JPG q80), PSNR bằng hoặc cao hơn, nhưng encode chậm gấp 3–6 lần (434 ms/ảnh ở LL).
- Ảnh mẫu là ảnh tổng hợp (nhiễu + gradient + nét cứng). Tỉ lệ WebP/AVIF so với JPG trên ảnh chụp thật thường khác. Cần chạy lại `compare.mjs` với ảnh thật của dự án trước khi chốt định dạng mặc định (câu hỏi Q2).

Độ trễ:

- Một lần gọi CLI `imgfit resize` (khởi động Node + nạp sharp + 1 ảnh 3000×2000 → 640×480): **median 306 ms** (283–444 ms). Xử lý ảnh trong process chỉ ~46 ms, nên ~260 ms là chi phí khởi động. Chế độ service bỏ được phần này.
