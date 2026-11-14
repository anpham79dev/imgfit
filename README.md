# imgfit

Công cụ **resize, chuyển định dạng và chuẩn hóa ảnh hàng loạt** trước khi đưa vào repository, dùng cho mọi dự án: web, mobile, game, tài liệu… Lõi xử lý viết bằng Node.js + [sharp](https://sharp.pixelplumbing.com/) (libvips). **Ngôn ngữ nào cũng dùng được** thông qua CLI có output JSON ổn định: Python, PHP/Laravel, Go, C#/Unity, shell, CI… Riêng Node có thêm API để import trực tiếp.

```bash
imgfit resize "raw/**/*.{jpg,png}" --size 256x256 --mode cover --format webp --output public/img
```

Nguyên tắc thiết kế: **không bao giờ làm mất dữ liệu** (không đè file lạ, không sửa ảnh gốc, kiểm tra trùng đích trước khi ghi), **kết quả dự đoán được** (dry-run báo đúng kích thước sẽ ra), **an toàn mặc định** (không phóng to, bỏ metadata, không âm thầm xử lý ảnh động).

---

## Mục lục

- [Cài đặt](#cài-đặt)
- [Bắt đầu trong 5 phút](#bắt-đầu-trong-5-phút)
- [Lệnh `resize`](#lệnh-resize)
  - [Input](#input)
  - [Tất cả tùy chọn](#tất-cả-tùy-chọn)
  - [Chế độ resize](#chế-độ-resize)
  - [Ảnh nhỏ hơn kích thước đích](#ảnh-nhỏ-hơn-kích-thước-đích)
  - [Điểm crop và focal point](#điểm-crop-và-focal-point)
  - [Định dạng, alpha, metadata](#định-dạng-alpha-metadata)
  - [Đặt tên output](#đặt-tên-output)
  - [Ghi file an toàn](#ghi-file-an-toàn)
- [Các lệnh khác](#các-lệnh-khác)
- [Output JSON, exit code, mã lỗi](#output-json-exit-code-mã-lỗi)
- [Tích hợp từ ngôn ngữ khác](#tích-hợp-từ-ngôn-ngữ-khác)
- [Hiệu năng](#hiệu-năng)
- [Giới hạn](#giới-hạn)
- [FAQ](#faq)
- [Phát triển](#phát-triển)

---

## Cài đặt

**Yêu cầu:** Node.js **≥ 20.3** trên Windows, Linux (kể cả WSL) hoặc macOS. Thư viện sharp tự tải binary libvips dựng sẵn cho từng nền tảng, không cần cài thêm gì. Nếu môi trường đặc biệt (Alpine, ARM cũ, máy không có mạng), xem [hướng dẫn cài sharp](https://sharp.pixelplumbing.com/install/).

Có ba cách cài:

```bash
# 1) Từ file .tgz đã đóng gói (khuyến nghị cho nội bộ)
npm run build && npm pack                 # trong repo imgfit → imgfit-<version>.tgz
npm install -D /đường/dẫn/imgfit-<version>.tgz # trong dự án dùng nó

# 2) Từ Git, nhớ pin tag hoặc commit
npm install -D git+https://<git-host>/<org>/imgfit.git#v<version>

# 3) Chạy thẳng từ source
git clone <repo> && cd imgfit && npm ci && npm run build
node dist/bin.js --version
```

Sau khi cài trong một dự án Node, chạy bằng `npx imgfit …` hoặc thêm vào `package.json`:

```json
{
  "scripts": {
    "images": "imgfit resize raw -r -s 256x256 -m cover -f webp -o public/img --name \"{dir}/{name}.{ext}\""
  }
}
```

> Cách 2 (cài từ Git) cần build ở máy người cài. Tránh việc đó bằng cách dùng `.tgz` đã build sẵn (cách 1).

---

## Bắt đầu trong 5 phút

```bash
# 1. Xem ảnh có gì (định dạng thật, kích thước sau khi xoay EXIF, alpha)
imgfit info raw/photo.jpg

# 2. Xem trước sẽ ra gì, KHÔNG ghi file nào
imgfit resize raw/ --recursive --size 256x256 --mode cover --format webp --output out/ --dry-run

# 3. Chạy thật
imgfit resize raw/ --recursive --size 256x256 --mode cover --format webp --output out/

# 4. Chạy lại lần nữa → imgfit không đè (E_OUTPUT_CONFLICT). Muốn thay có chủ đích:
imgfit resize raw/ -r -s 256x256 -m cover -f webp -o out/ --overwrite --backup
```

Output dạng dễ đọc:

```text
NEW   raw/a.jpg → out/a.webp  1200×800 → 256×256  412.0 KB → 9.8 KB
NEW   raw/logo.png → out/logo.webp  300×300 → 256×256  2.5 KB → 1.1 KB
FAIL  raw/tiny.jpg → ?  100×80 → ?  3.1 KB → unknown
      ✗ E_SMALL_INPUT: Ảnh nguồn 100×80 nhỏ hơn target 256×256 (mode cover); không phóng to. …

FAILED: 3 file · 2 tạo mới, 0 thay thế · 0 bỏ qua · 1 lỗi · tiết kiệm 403.6 KB · 0.21s
```

Dùng trong script hoặc từ ngôn ngữ khác thì thêm `--json`. Khi đó stdout chỉ chứa một document JSON (xem [Output JSON](#output-json-exit-code-mã-lỗi)).

---

## Lệnh `resize`

```text
imgfit resize <inputs...> --size <WxH> --output <dir> [options]
```

### Input

Mỗi input có thể là:

| Loại    | Ví dụ                  | Ghi chú                                                                                        |
| ------- | ---------------------- | ---------------------------------------------------------------------------------------------- |
| File    | `raw/a.jpg`            | Định dạng được nhận diện theo **nội dung**, không theo đuôi                                    |
| Thư mục | `raw/`                 | Quét các đuôi `jpg jpeg png webp avif tif tiff gif`. Thêm `--recursive` để quét cả thư mục con |
| Glob    | `"raw/**/*.{jpg,png}"` | **Đặt trong ngoặc kép** để shell không tự mở rộng. Luôn dùng `/`, kể cả trên Windows           |

Có thể truyền nhiều input một lúc; file trùng nhau tự được loại bỏ. Khi quét, imgfit không đi theo symlink. Đường dẫn tương đối tính theo thư mục hiện tại.

### Tất cả tùy chọn

| Tùy chọn                  | Mặc định                                    | Ý nghĩa                                                                              |
| ------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `-s, --size <WxH>`        | _(bắt buộc)_                                | Kích thước đích, vd. `256x256`, `1920x1080`, hoặc `512` cho ảnh vuông                |
| `-o, --output <dir>`      | _(bắt buộc)_                                | Thư mục output. Được tạo nếu chưa có, trừ khi chạy `--dry-run`                       |
| `-m, --mode <mode>`       | `fit`                                       | `fit` \| `cover` \| `pad`, xem [Chế độ resize](#chế-độ-resize)                       |
| `-f, --format <fmt>`      | `keep`                                      | `keep` \| `jpg` \| `png` \| `webp` \| `avif`                                         |
| `-q, --quality <1-100>`   | jpg 85, webp 82, avif 50                    | Chất lượng encoder. PNG chỉ dùng tùy chọn này khi bật `--png-palette`                |
| `-n, --name <template>`   | `{name}.{ext}`                              | Template tên output, xem [Đặt tên output](#đặt-tên-output)                           |
| `-r, --recursive`         | tắt                                         | Quét thư mục con khi input là thư mục                                                |
| `--position <pos>`        | `center`                                    | Điểm crop cho `cover`: `center` \| `top` \| `attention` \| `focal`                   |
| `--focal <x,y>`           | —                                           | Focal point chuẩn hóa `[0,1]`, vd. `0.5,0.3`. Tự bật `--position focal`              |
| `--background <hex>`      | trong suốt (PNG/WebP/AVIF), `#ffffff` (JPG) | Màu nền khi `pad` và khi flatten alpha sang JPG. Dạng `#rgb`, `#rrggbb`, `#rrggbbaa` |
| `--small-input <p>`       | `fit`: `keep`; `cover`/`pad`: `error`       | Cách xử lý ảnh nhỏ hơn đích: `error` \| `keep` \| `pad`                              |
| `--upscale`               | tắt                                         | Cho phép phóng to ảnh nhỏ                                                            |
| `--sharpen [sigma]`       | tắt                                         | Làm nét sau khi giảm cỡ; sigma từ 0.3 đến 10 (mặc định 1)                            |
| `--keep-metadata`         | tắt                                         | Giữ EXIF/XMP/ICC. Mặc định bỏ hết và chuyển sang sRGB                                |
| `--png-palette`           | tắt                                         | PNG dạng palette: file nhỏ hơn, có thể giảm chất lượng ảnh có gradient               |
| `--png-compression <0-9>` | `6`                                         | Mức nén PNG; không đổi chất lượng ảnh, chỉ đổi tốc độ và dung lượng                  |
| `-j, --jobs <n>`          | `4`                                         | Số ảnh xử lý song song (1–64)                                                        |
| `--overwrite`             | tắt                                         | Thay output đã tồn tại                                                               |
| `--skip-existing`         | tắt                                         | Bỏ qua nếu output đã tồn tại. **Không kiểm tra** output cũ có đúng không             |
| `--backup`                | tắt                                         | Sao lưu file cũ trước khi thay, vào `.imgfit/backups/<lần-chạy>/`                    |
| `--backup-dir <dir>`      | `.imgfit/backups`                           | Thư mục backup khác                                                                  |
| `--max-pixels <n>`        | 268 402 689                                 | Giới hạn số pixel input, chống ảnh "bom giải nén"                                    |
| `--dry-run`               | tắt                                         | Chỉ lập kế hoạch: không tạo thư mục, không ghi file nào                              |
| `--json`                  | tắt                                         | stdout chỉ chứa JSON report                                                          |
| `--quiet`                 | tắt                                         | Chỉ in lỗi và dòng tổng kết                                                          |
| `--verbose`               | tắt                                         | In thêm version sharp/libvips/Node                                                   |

`--overwrite` và `--skip-existing` không dùng chung được với nhau.

### Chế độ resize

Mọi chế độ đều **xoay ảnh theo EXIF trước** (kể cả ảnh bị lật gương, orientation 2/4/5/7), rồi mới tính khung.

| Mode    | Kết quả                                     | Kích thước output            |
| ------- | ------------------------------------------- | ---------------------------- |
| `fit`   | Thu ảnh cho vừa khung, giữ tỷ lệ, không cắt | ≤ W×H; có thể không đúng W×H |
| `cover` | Lấp kín khung, cắt bớt phần thừa, giữ tỷ lệ | Đúng W×H                     |
| `pad`   | Thu ảnh cho vừa khung rồi đệm nền cho đủ    | Đúng W×H                     |

### Ảnh nhỏ hơn kích thước đích

Mặc định imgfit **không phóng to**. Nếu chỉ giữ nguyên kích thước thì không thể vừa "đúng W×H" vừa "không phóng to", nên với ảnh nhỏ phải chọn rõ một cách xử lý:

| `--small-input` | `fit`                           | `cover`                                                     | `pad`                                                |
| --------------- | ------------------------------- | ----------------------------------------------------------- | ---------------------------------------------------- |
| `keep`          | Giữ kích thước gốc _(mặc định)_ | Chỉ crop về đúng tỷ lệ, không resize (`W_SMALL_INPUT_KEPT`) | Giữ kích thước gốc, không đệm (`W_SMALL_INPUT_KEPT`) |
| `error`         | Báo `E_SMALL_INPUT`             | Báo `E_SMALL_INPUT` _(mặc định)_                            | Báo `E_SMALL_INPUT` _(mặc định)_                     |
| `pad`           | Đệm nền lên W×H                 | Đệm nền lên W×H                                             | Đệm nền lên W×H (`W_SMALL_INPUT_PADDED`)             |

"Nhỏ" nghĩa là: với `cover`, **một** chiều nhỏ hơn đích là đủ; với `fit`/`pad`, phải **cả hai** chiều đều nhỏ hơn. Thêm `--upscale` thì không còn trường hợp ảnh nhỏ (ảnh luôn được phóng to).

### Điểm crop và focal point

Áp dụng cho `--mode cover`:

| `--position` | Hành vi                                                                                                     |
| ------------ | ----------------------------------------------------------------------------------------------------------- |
| `center`     | Giữ phần giữa ảnh _(mặc định)_                                                                              |
| `top`        | Giữ mép trên, hợp với chân dung hoặc ảnh có chữ ở trên                                                      |
| `attention`  | Heuristic của libvips: chọn vùng nổi bật (màu da, độ bão hòa, chi tiết). **Không phải nhận diện khuôn mặt** |
| `focal`      | Giữ điểm `--focal x,y` ở giữa khung nhiều nhất có thể, rồi clamp trong biên ảnh                             |

Tọa độ focal là tỷ lệ `[0,1]` trên **ảnh đã xoay theo EXIF**, tức là ảnh bạn nhìn thấy. `0,0` là góc trên trái, `1,1` là góc dưới phải. Ví dụ để giữ khuôn mặt nằm ở 1/3 trên của ảnh:

```bash
imgfit resize portrait.jpg -s 256 -m cover --focal 0.5,0.33 -f jpg -o out/
```

### Định dạng, alpha, metadata

- **Input nhận được:** JPEG, PNG, WebP, AVIF, TIFF, GIF (một frame). Kiểm tra bằng **nội dung file**: một file PNG bị đổi đuôi thành `.jpg` vẫn được đọc là PNG. Với `--format keep`, output sẽ là `.png`.
- **Từ chối rõ ràng:** ảnh động GIF/APNG/WebP nhiều frame (`E_INPUT_ANIMATED`), HEIC (`E_INPUT_UNSUPPORTED`), file rỗng hoặc hỏng (`E_INPUT_CORRUPT`). imgfit không âm thầm lấy frame đầu.
- **`--format keep`** giữ định dạng cho JPEG/PNG/WebP/AVIF. TIFF và GIF không có encoder tương ứng, nên báo `E_FORMAT_UNSUPPORTED`; khi đó hãy chọn `--format` cụ thể.
- **Alpha sang JPG:** JPG không có độ trong suốt, nên ảnh được flatten lên `--background` (mặc định trắng) kèm cảnh báo `W_ALPHA_FLATTENED`. Nếu không đặt màu nền thì có thêm `W_DEFAULT_BACKGROUND`.
- **PNG, WebP, AVIF giữ alpha.** Phần đệm của `pad` mặc định trong suốt.
- **Metadata:** mặc định **bỏ** EXIF (kể cả GPS), XMP và ICC, rồi chuyển về sRGB. Dùng `--keep-metadata` để giữ lại (kèm cảnh báo `W_METADATA_KEPT`).
- **Xác minh output:** sau khi encode, imgfit đọc lại file. Nếu định dạng hoặc kích thước không khớp kế hoạch thì báo `E_OUTPUT_INVALID` và không publish file đó. Đuôi file luôn khớp với bytes thật; nếu template đặt sai đuôi thì báo `E_EXTENSION_MISMATCH`.

### Đặt tên output

`--name` là template **tương đối theo `--output`**:

| Placeholder  | Giá trị                                                                                                          |
| ------------ | ---------------------------------------------------------------------------------------------------------------- |
| `{name}`     | Tên file nguồn không đuôi, đã làm sạch                                                                           |
| `{ext}`      | Đuôi theo **định dạng output thật**: `jpg`, `png`, `webp`, `avif`                                                |
| `{w}`, `{h}` | Kích thước đích trong `--size`                                                                                   |
| `{dir}`      | Thư mục con tương đối so với input (thư mục hoặc phần tĩnh của glob). Là placeholder duy nhất có thể sinh ra `/` |

```bash
--name "{name}.{ext}"               # a.webp (mặc định)
--name "{dir}/{name}.{ext}"         # giữ cấu trúc thư mục: sub/a.webp
--name "{name}-{w}x{h}.{ext}"       # a-256x256.webp
--name "thumbs/{name}@2x.{ext}"     # thumbs/a@2x.webp
```

Để tên file dùng được trên mọi hệ điều hành, imgfit tự làm sạch từng phần của đường dẫn:

- Chuẩn hóa Unicode về NFC.
- Thay các ký tự cấm trên Windows (`<>:"/\|?*`) bằng `_`.
- Bỏ dấu chấm và khoảng trắng ở cuối.
- Tránh tên reserved của Windows: `CON` thành `_CON`, `nul.jpg` thành `_nul.jpg`.

Template bị từ chối nếu có `..`, là đường dẫn tuyệt đối, hoặc dùng placeholder không có trong danh sách trên.

### Ghi file an toàn

1. **Kiểm tra cả batch trước khi ghi.** Nếu hai input cùng ra một đích (so sánh không phân biệt hoa/thường và dạng Unicode, ví dụ `Photo.jpg` và `photo.png` cùng ra `photo.webp`), hoặc output trùng với một file nguồn, thì **cả batch dừng lại, không ghi file nào** (`status: "aborted"`, mã `E_OUTPUT_COLLISION` / `E_OUTPUT_SAME_AS_SOURCE`).
2. **Không đè file có sẵn**, trừ khi bạn chọn `--overwrite`. Khi tạo file mới, imgfit dùng thao tác "tạo độc quyền" (hard link, hoặc copy với cờ `COPYFILE_EXCL` nếu filesystem không hỗ trợ hard link). Nhờ vậy, kể cả khi có tiến trình khác vừa tạo file cùng tên, file đó cũng không bị đè.
3. **Ghi ra file tạm rồi mới publish.** File tạm nằm cùng thư mục đích, tên dạng `.<tên>.imgfit-<ngẫu nhiên>.tmp` (bắt đầu bằng dấu chấm, đuôi `.tmp`) để Unity, Vite, webpack… bỏ qua khi watch/import. File tạm được xác minh rồi mới publish; nếu lỗi thì bị xóa.
4. **`--overwrite --backup`** copy file cũ vào `.imgfit/backups/<thời-điểm>-<id>/<đường-dẫn>` trước khi thay. Backup **không** nằm cạnh output, vì vậy không bị Unity import thành asset hay bị web server public. Nhớ thêm `.imgfit/` vào `.gitignore`.
5. **Không ghi ra ngoài `--output`.** Kể cả qua symlink hoặc junction: đường dẫn được kiểm tra bằng `realpath` ngay trước khi ghi. Không ghi đè lên symlink.
6. **Windows:** nếu file đang bị editor, IDE hoặc antivirus giữ (`EBUSY`/`EPERM`), imgfit thử lại với độ trễ tăng dần, sau đó mới báo lỗi và giữ nguyên bản cũ.
7. **Không bao giờ sửa hoặc xóa ảnh nguồn.**
8. **Ctrl+C:** imgfit không bắt đầu ảnh mới, chờ các ảnh đang xử lý xong, ảnh đã ghi vẫn được giữ, rồi thoát với mã 130. Nhấn Ctrl+C lần hai để thoát ngay.

> Thay file bằng `rename` là nguyên tử trên cùng filesystem ở Linux và macOS. Trên Windows, imgfit không khẳng định điều này tuyệt đối. Nếu thay file thất bại, bản cũ được giữ nguyên.

---

## Các lệnh khác

```bash
imgfit info <file> [--json]      # metadata: định dạng thật, kích thước sau EXIF, alpha, colorspace, ICC
imgfit capabilities [--json]     # định dạng input/output mà bản build trên máy này hỗ trợ + version
imgfit schema result             # JSON Schema của report (dùng để validate hoặc sinh type)
imgfit schema info               # JSON Schema của `info --json`
imgfit --version [--json]        # version; thêm --json để có version sharp/libvips/node/platform
imgfit <lệnh> --help             # hướng dẫn chi tiết
```

---

## Output JSON, exit code, mã lỗi

### Report (`resize --json`)

```json
{
  "schemaVersion": 1,
  "tool": {
    "name": "imgfit",
    "version": "0.1.0",
    "sharp": "0.35.5",
    "libvips": "8.18.7"
  },
  "command": "resize",
  "status": "ok",
  "dryRun": false,
  "startedAt": "2026-11-14T04:42:00.315Z",
  "elapsedMs": 212,
  "summary": {
    "total": 1,
    "processed": 1,
    "created": 1,
    "replaced": 0,
    "planned": 0,
    "skipped": 0,
    "failed": 0,
    "cancelled": 0,
    "inputBytes": 421888,
    "outputBytes": 10035,
    "bytesSaved": 411853
  },
  "files": [
    {
      "file": "raw/a.jpg",
      "destination": "out/a.webp",
      "status": "created",
      "preset": null,
      "format": "webp",
      "inputBytes": 421888,
      "outputBytes": 10035,
      "inputPx": [1200, 800],
      "outputPx": [256, 256],
      "elapsedMs": 61,
      "fingerprint": "sha256:9f2c…",
      "warnings": [],
      "errors": []
    }
  ],
  "errors": []
}
```

- `status` của report: `ok` | `failed` (có file lỗi) | `aborted` (dừng trước khi ghi, vd. trùng đích) | `cancelled` (Ctrl+C).
- `status` của từng file: `planned` (dry-run) | `created` | `replaced` | `skipped` | `failed` | `cancelled`.
- Đường dẫn luôn dùng `/`, tương đối theo thư mục hiện tại (nếu nằm trong thư mục đó).
- `inputPx`/`outputPx` là `[rộng, cao]` sau khi xoay theo EXIF. `outputBytes: null` nghĩa là chưa biết (dry-run, lỗi, hoặc bị skip).
- `fingerprint` là SHA-256 của bytes nguồn + options hiệu lực + version pipeline/sharp/libvips. Cùng input + cùng options + cùng version → cùng fingerprint.
- Khi lỗi xảy ra **trước khi chạy** (sai tham số, không tìm thấy input), stdout là một **ErrorDocument**:
  ```json
  { "schemaVersion": 1, "tool": { … }, "command": "resize", "status": "error",
    "errors": [{ "code": "E_INPUT_NOT_FOUND", "message": "Không tìm thấy input: nope/" }] }
  ```
- Schema đầy đủ: [schema/result.schema.json](schema/result.schema.json) (hoặc `imgfit schema result`). Thay đổi phá vỡ cấu trúc chỉ xảy ra khi tăng `schemaVersion`.

> **Hãy xử lý theo `code`, đừng parse `message`.** Message là tiếng Việt, viết cho người đọc, và có thể đổi giữa các bản.

### Exit code

| Code  | Ý nghĩa                                                       |
| ----- | ------------------------------------------------------------- |
| `0`   | Mọi file thành công (hoặc bị skip có chủ đích)                |
| `1`   | Có ít nhất một file lỗi, hoặc batch bị dừng vì trùng đích     |
| `2`   | Sai tham số, lệnh không tồn tại, không tìm thấy input         |
| `3`   | Lỗi quyền truy cập hoặc môi trường khiến lệnh không chạy được |
| `130` | Bị hủy bằng Ctrl+C                                            |

### Mã lỗi (`E_*`)

| Mã                        | Khi nào                                                                           |
| ------------------------- | --------------------------------------------------------------------------------- |
| `E_USAGE`                 | Tham số sai (kích thước, quality, template, màu…)                                 |
| `E_INPUT_NOT_FOUND`       | Input không tồn tại hoặc glob không khớp file nào                                 |
| `E_INPUT_UNSUPPORTED`     | Không phải ảnh, hoặc định dạng không hỗ trợ (vd. HEIC)                            |
| `E_INPUT_CORRUPT`         | File rỗng, hỏng hoặc bị cắt cụt                                                   |
| `E_INPUT_ANIMATED`        | Ảnh động (GIF/APNG/WebP nhiều frame)                                              |
| `E_INPUT_TOO_LARGE`       | Vượt `--max-pixels`                                                               |
| `E_SMALL_INPUT`           | Ảnh nhỏ hơn đích và `--small-input error`                                         |
| `E_FORMAT_UNSUPPORTED`    | `--format keep` với định dạng không có encoder (TIFF, GIF)                        |
| `E_EXTENSION_MISMATCH`    | Đuôi trong `--name` không khớp định dạng output                                   |
| `E_OUTPUT_CONFLICT`       | Đích đã tồn tại (dùng `--overwrite` hoặc `--skip-existing`), hoặc đích là thư mục |
| `E_OUTPUT_COLLISION`      | Nhiều input cùng ra một đích; cả batch dừng                                       |
| `E_OUTPUT_SAME_AS_SOURCE` | Output trùng với file nguồn; cả batch dừng                                        |
| `E_OUTPUT_INVALID`        | Output encode xong nhưng sai định dạng hoặc kích thước; không được publish        |
| `E_PATH_UNSAFE`           | Đích nằm ngoài `--output` (kể cả qua symlink), hoặc ghi lên symlink               |
| `E_PERMISSION`            | Không có quyền đọc/ghi                                                            |
| `E_DISK_FULL`             | Hết dung lượng ổ đĩa                                                              |
| `E_WRITE_FAILED`          | Ghi hoặc publish thất bại vì lý do khác                                           |
| `E_CANCELLED`             | Bị hủy                                                                            |
| `E_INTERNAL`              | Lỗi không phân loại được, hãy báo lại kèm output `--verbose`                      |

### Mã cảnh báo (`W_*`)

| Mã                           | Ý nghĩa                                                    |
| ---------------------------- | ---------------------------------------------------------- |
| `W_ALPHA_FLATTENED`          | Ảnh có alpha bị flatten khi xuất JPG                       |
| `W_DEFAULT_BACKGROUND`       | Đã dùng nền trắng mặc định cho JPG                         |
| `W_SMALL_INPUT_KEPT`         | Ảnh nhỏ, giữ kích thước nhỏ hơn đích                       |
| `W_SMALL_INPUT_PADDED`       | Ảnh nhỏ, đã đệm nền thay vì phóng to                       |
| `W_SKIP_EXISTING_UNVERIFIED` | Bỏ qua vì đích đã có; output cũ **không được kiểm tra**    |
| `W_METADATA_KEPT`            | Đang giữ metadata (có thể chứa GPS hoặc thông tin cá nhân) |

---

## Tích hợp từ ngôn ngữ khác

Hợp đồng chung cho mọi ngôn ngữ:

1. Gọi tiến trình con bằng **mảng tham số** (không qua shell), để không phải lo quoting hay injection.
2. Thêm `--json`. Khi đó **stdout chỉ chứa JSON**, còn log và progress đi ra stderr.
3. Kiểm tra exit code và `status`, xử lý theo `errors[].code`.
4. Tìm binary theo biến môi trường **`IMGFIT_BIN`** trước, rồi mới tới `imgfit` trên `PATH`.

Các ví dụ chạy được nằm trong [examples/](examples/).

### Node (API trực tiếp)

```js
import { resize } from "imgfit";

const report = await resize({
  inputs: ["raw"],
  output: "public/img",
  recursive: true,
  width: 256,
  height: 256,
  mode: "cover",
  format: "webp",
  name: "{dir}/{name}.{ext}",
  onEvent: (e) =>
    console.error(`[${e.completed}/${e.total}] ${e.type} ${e.file}`),
});
if (report.status !== "ok") process.exitCode = 1;
```

API còn có `info()`, `capabilities()`, `planTransform()`, `ImgfitError`, `exitCodeFor()` và đầy đủ type TypeScript. Lỗi tham số và lỗi không tìm thấy input được **throw** dưới dạng `ImgfitError` (có `.code`); lỗi của từng file nằm trong report.

### Python

```python
import json, os, shutil, subprocess

bin = os.environ.get("IMGFIT_BIN") or shutil.which("imgfit")
proc = subprocess.run(
    [bin, "resize", "raw", "-r", "-s", "256x256", "-m", "cover", "-f", "webp", "-o", "out", "--json"],
    capture_output=True, text=True, encoding="utf-8",
)
report = json.loads(proc.stdout)          # vẫn là JSON khi exit != 0
if proc.returncode != 0:
    raise SystemExit([e["code"] for f in report.get("files", []) for e in f["errors"]] or report["errors"])
```

Bản đầy đủ: [examples/python/resize.py](examples/python/resize.py).

### PHP / Laravel

Laravel 10 trở lên:

```php
use Illuminate\Support\Facades\Process;

$result = Process::run([env('IMGFIT_BIN', 'imgfit'), 'resize', 'raw', '-r',
    '-s', '256x256', '-m', 'cover', '-f', 'webp', '-o', public_path('img'), '--json']);
$report = json_decode($result->output(), true, flags: JSON_THROW_ON_ERROR);
if ($result->failed()) {
    throw new RuntimeException('imgfit: ' . json_encode(array_column($report['errors'] ?? [], 'code')));
}
```

PHP thuần (không framework) dùng `proc_open` với mảng lệnh: [examples/php/resize.php](examples/php/resize.php).

### Go

```go
out, err := exec.Command(bin, "resize", "raw", "-r", "-s", "256x256", "-m", "cover",
    "-f", "webp", "-o", "out", "--json").Output()  // exit != 0 vẫn có stdout; err là *exec.ExitError
var report struct {
    Status  string `json:"status"`
    Summary struct{ Failed int `json:"failed"` } `json:"summary"`
}
_ = json.Unmarshal(out, &report)
```

Bản đầy đủ: [examples/go/main.go](examples/go/main.go).

### Shell, PowerShell, CI

```bash
imgfit resize raw -r -s 256x256 -m cover -f webp -o out --json > imgfit-report.json
jq -r '.files[] | select(.status=="failed") | "\(.file): \(.errors[0].code)"' imgfit-report.json
```

Trong PowerShell, đặt template trong **nháy đơn**: `--name '{dir}/{name}.{ext}'`, vì PowerShell hiểu `{…}` là scriptblock. Xem [examples/shell/](examples/shell/).

GitHub Actions (resize như một bước build):

```yaml
- uses: actions/setup-node@v4
  with: { node-version: 22 }
- run: npm ci
- run: npx imgfit resize assets/raw -r -s 1024x1024 -f webp -o dist/img --json > imgfit-report.json
```

### Unity (C#)

Gọi bằng `System.Diagnostics.Process` theo cùng hợp đồng: `ArgumentList` cho từng tham số, đọc `StandardOutput` rồi parse JSON. File tạm có tên bắt đầu bằng `.`, nên Unity không import nó. Ghi đè cùng đường dẫn chỉ thay bytes của ảnh, **không đụng file `.meta`**, nên GUID được giữ nguyên.

### Lưu ý trên Windows

Khi cài qua npm, lệnh `imgfit` thực chất là shim `imgfit.cmd`:

- **Python** `subprocess` cần đường dẫn đầy đủ: `shutil.which("imgfit")` trả về `…\imgfit.CMD`, như trong ví dụ.
- **PHP** `proc_open` cần gọi `imgfit.cmd`.
- **Go** `exec.Command("imgfit")` tự tìm theo `PATHEXT`.
- Nếu tham số có ký tự đặc biệt của `cmd.exe` (`%`, `^`, `&`), nên gọi thẳng `node <đường-dẫn>/node_modules/imgfit/dist/bin.js` thay vì qua shim.

---

## Hiệu năng

Số đo bằng `npm run bench` (3 lần mỗi case, lấy median). Ảnh **tự sinh từ nhiễu Gaussian**: khó nén hơn ảnh thật, nên đây gần với trường hợp xấu. Filesystem cache ấm.

Máy đo: Intel Core 5 210H (12 luồng), 16 GB RAM, Windows 11, Node 24.16, sharp 0.35.5, libvips 8.18.7. Peak RSS của cả tiến trình benchmark: 445 MB.

| Workload                                           | jobs=1 | jobs=2 | jobs=4    | jobs=8 |
| -------------------------------------------------- | ------ | ------ | --------- | ------ |
| 200 JPG 2400×2400 (781 MB) → 256×256 cover JPG q85 | 16.9 s | 9.1 s  | **7.1 s** | 6.6 s  |
| 10 PNG alpha 3000×3000 (359 MB) → fit 1024 PNG     | 2.6 s  | 1.5 s  | **1.3 s** | 1.6 s  |

Nhận xét: `jobs=4` (mặc định) đã gần mức bão hòa; tăng lên 8 thì lợi ít hoặc chậm hơn, vì bản thân libvips cũng chạy đa luồng. Kết quả trên máy bạn sẽ khác, hãy tự chạy:

```bash
npm run bench                                   # mặc định như bảng trên
node scripts/bench.mjs --count 50 --jobs 2,4 --json
```

Ghi chú kỹ thuật:

- imgfit chỉ tắt cache **file handle** của libvips (`sharp.cache({ files: 0 })`). Lý do: trên Windows, cache này khóa file nguồn và file tạm. Cache bộ nhớ vẫn giữ mặc định.
- `UV_THREADPOOL_SIZE` phải được đặt trong môi trường **trước khi** chạy Node nếu bạn muốn chỉnh; imgfit không tự đặt.

---

## Giới hạn

- Cần Node.js ≥ 20.3 trên máy chạy imgfit (dự án dùng nó có thể viết bằng bất kỳ ngôn ngữ nào).
- Mỗi lần `resize` encode lại toàn bộ input; không có cache giữa các lần chạy.
- Không hỗ trợ: ảnh động, HEIC, SVG, PSD/RAW, PDF, tải ảnh từ URL, nhận diện khuôn mặt.
- Output **không giống từng byte** giữa các version sharp/libvips, hay với imgproxy và các công cụ khác. Chỉ có kích thước và quy tắc được đảm bảo.
- `attention` là heuristic, có thể crop lệch mặt; dùng `--focal` cho ảnh quan trọng.
- Mặc định không dùng mozjpeg, PNG palette hay nén PNG mức 9. Các tùy chọn này cần được đánh giá chất lượng trước khi bật.

## FAQ

**Chạy lại có đè ảnh không?** Không. Mặc định gặp đích đã tồn tại là báo `E_OUTPUT_CONFLICT`. Dùng `--overwrite` (có thể kèm `--backup`) nếu muốn thay, hoặc `--skip-existing` để bỏ qua.

**Sao ảnh nhỏ bị báo lỗi?** Với `cover`/`pad`, imgfit không phóng to và không "giả vờ" tạo ảnh đúng W×H. Chọn `--small-input keep|pad` hoặc `--upscale` nếu chấp nhận.

**Ảnh chụp điện thoại bị xoay ngang?** imgfit đã xoay theo EXIF trước khi resize. Output không còn tag orientation và hiển thị đúng ở mọi nơi.

**Có giữ GPS trong ảnh không?** Không, metadata bị bỏ mặc định. Chỉ giữ khi dùng `--keep-metadata`.

**Thư mục `.imgfit/` là gì?** Chứa backup (khi dùng `--backup`). Thêm vào `.gitignore`.

**Thấy file `.xxx.imgfit-….tmp` còn sót?** Đó là file tạm của một lần chạy bị dừng đột ngột (tắt máy, kill). File này an toàn để xóa.

**Dùng với dự án không có Node?** Cần cài Node ≥ 20.3 trên máy chạy imgfit. Dự án của bạn vẫn dùng bất kỳ ngôn ngữ nào, chỉ cần gọi CLI.

---

## Phát triển

```bash
npm ci
npm run build        # tsc → dist/
npm test             # vitest: unit + integration (ảnh test tự sinh, không cần fixture có bản quyền)
npm run typecheck
npm run bench        # build + benchmark
npm pack             # đóng gói .tgz (chạy npm run build trước)
```

Cấu trúc:

```text
src/
├── bin.ts               # entry của lệnh `imgfit` (SIGINT → hủy êm)
├── cli.ts               # commander, parse tham số, in kết quả, exit code — main(argv, io) test được in-process
├── index.ts             # Node API công khai
├── version.ts
├── commands/
│   ├── resize.ts        # thu thập input → probe/plan → preflight trùng đích → xử lý song song → publish
│   └── info.ts          # info + capabilities
└── core/
    ├── geometry.ts      # toán resize/crop/focal thuần
    ├── process.ts       # probe (metadata, phát hiện ảnh động), planTransform (thuần), transformToFile (sharp)
    ├── output.ts        # file tạm, publish độc quyền, replace + backup, retry trên Windows
    ├── paths.ts         # sanitize tên, khóa so trùng, kiểm tra realpath/symlink
    ├── template.ts      # template tên output
    ├── inputs.ts        # file / thư mục / glob
    ├── formats.ts       # whitelist định dạng
    ├── fingerprint.ts   # SHA-256 nguồn + options + version
    ├── report.ts        # cấu trúc JSON report
    ├── errors.ts        # mã lỗi/cảnh báo ổn định
    └── exit.ts          # exit code
schema/                  # JSON Schema công khai
examples/                # node, python, php, go, shell
scripts/bench.mjs
test/{unit,integration}/
docs/                    # tài liệu thiết kế
```

Quy ước khi đóng góp:

- Mã lỗi/cảnh báo, exit code, cấu trúc JSON và placeholder là **hợp đồng công khai**. Chỉ được thêm mới; muốn đổi nghĩa thì phải tăng `schemaVersion`.
- Mọi thay đổi pipeline làm khác bytes output phải tăng `PIPELINE_VERSION` trong [src/core/fingerprint.ts](src/core/fingerprint.ts).
- Test dùng ảnh tự sinh trong thư mục tạm. **Không commit ảnh có bản quyền.**
