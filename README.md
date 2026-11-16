# imgfit

Engine xử lý ảnh dùng chung: resize, chuyển định dạng, gắn watermark. Ứng dụng backend (PHP, Python, Node, shell…) gọi imgfit để chuẩn bị các bản ảnh trước khi tự upload lên storage (R2, S3…). Gọi qua CLI, nhận lại report JSON.

- **Hành vi rõ ràng, có test**: không phóng to ảnh nhỏ, cả hai chiều luôn nằm trong khung, xoay theo EXIF, bỏ GPS/metadata, nền trắng khi PNG trong suốt sang JPG. Mỗi quy tắc có test trên bộ ảnh mẫu (`test/behavior/`).
- **Một nguồn cấu hình**: preset (`L`, `LL`, `O`…) và watermark khai báo một lần trong `imgfit.json`, dùng được từ mọi ngôn ngữ.
- **Report giải thích từng ảnh**: kích thước, dung lượng, tên file cuối cùng, vị trí watermark, lý do bỏ qua, cảnh báo.
- **Một engine** (libvips qua [sharp](https://sharp.pixelplumbing.com/)): kết quả giống nhau trên mọi máy.
- UI cục bộ "kéo thả ảnh → resize → tải về" cho người dùng lẻ.

imgfit **không** upload lên storage, **không** resize lúc hiển thị (đó là việc của imgproxy hoặc Cloudflare Image Transformations), **không** xử lý PDF, video, ảnh động, HEIC/RAW.

## Mục lục

- [Cài đặt](#cài-đặt)
- [Bắt đầu nhanh](#bắt-đầu-nhanh)
- [`imgfit.json`: preset và watermark](#imgfitjson-preset-và-watermark)
- [Lệnh `resize`](#lệnh-resize)
- [Lệnh `exec`](#lệnh-exec)
- [Các lệnh khác](#các-lệnh-khác)
- [Report JSON, exit code, mã lỗi](#report-json-exit-code-mã-lỗi)
- [Gọi từ ngôn ngữ khác](#gọi-từ-ngôn-ngữ-khác)
- [Lưu ý cho bên upload (R2/CDN)](#lưu-ý-cho-bên-upload-r2cdn)
- [Web UI](#web-ui)
- [Giới hạn](#giới-hạn)
- [Phát triển](#phát-triển)

## Cài đặt

Cần **Node.js ≥ 20.15** (khuyến nghị Node 22 hoặc 24 LTS). Node từ bản 18 cần **glibc ≥ 2.28**, nên imgfit không chạy trực tiếp trên Linux cũ (ví dụ CentOS 7). Trên các máy đó dùng Docker. Alpine (musl) chạy được.

```bash
# từ file .tgz đã đóng gói (npm pack)
npm install -g ./imgfit-0.1.0.tgz
# hoặc từ Git, nhớ pin tag/commit
npm install -g git+https://<git-server>/imgfit.git#v0.1.0

imgfit --version
```

Docker (máy gọi không cần Node):

```bash
docker build -t imgfit:0.1.0 .
docker run --rm -v "$PWD:/work" -w /work --user "$(id -u):$(id -g)" imgfit:0.1.0 \
  resize upload/a.jpg --preset L,LL -o upload/out --json
```

## Bắt đầu nhanh

```bash
imgfit init                                   # tạo imgfit.json (preset L, LL, O) + imgfit.schema.json
imgfit resize upload/abc.jpg --preset L,LL,O -o upload/out --json
```

Kết quả: `upload/out/L_abc.jpg`, `upload/out/LL_abc.jpg`, `upload/out/abc.jpg`, và report JSON trên stdout (mỗi output một mục, có `destination`, `outputPx`, `outputBytes`, `status`, `warnings`).

Không cần `imgfit.json` nếu chỉ resize một lần:

```bash
imgfit resize photos/ -r --size 1600x1200 --format jpg -o out
```

## `imgfit.json`: preset và watermark

```json
{
  "$schema": "./imgfit.schema.json",
  "schemaVersion": 2,
  "presets": {
    "L":  { "size": [640, 480],   "mode": "fit", "smallInput": "keep", "format": { "keep": ["png", "webp"], "fallback": "jpg" }, "prefix": "L_" },
    "LL": { "size": [1600, 1200], "mode": "fit", "smallInput": "skip", "format": { "keep": ["png", "webp"], "fallback": "jpg" }, "prefix": "LL_", "watermark": "brand" },
    "O":  { "size": [2100, 1400], "mode": "fit", "smallInput": "keep", "format": "jpg", "watermark": "brand" }
  },
  "watermarks": {
    "brand": { "file": "brand/logo.png", "position": "bottom-left", "offset": ["1.5%", "5%"], "width": "15%", "minOutput": [640, 480] }
  }
}
```

imgfit tìm `imgfit.json` theo thứ tự: `--config <file>` (hoặc `"config"` trong job), biến môi trường `IMGFIT_CONFIG`, rồi tìm ngược từ thư mục hiện tại lên gốc. Schema: `imgfit schema config`.

### Preset

| Trường | Mặc định | Ý nghĩa |
|---|---|---|
| `size` | (bắt buộc) | `[rộng, cao]` của khung |
| `mode` | `fit` | `fit`: vừa khung, giữ tỉ lệ, cả hai chiều ≤ khung · `cover`: lấp kín rồi crop · `pad`: vừa khung rồi đệm nền đủ W×H |
| `format` | `keep` | `jpg` / `png` / `webp` / `avif` · `keep`: giữ định dạng input (lỗi nếu là GIF/TIFF) · `{ "keep": [...], "fallback": "jpg" }`: giữ nếu nằm trong danh sách, ngược lại dùng `fallback` |
| `quality` | JPG 80, WebP 82, AVIF 50 | 1–100 |
| `smallInput` | `fit` → `keep`; `cover`/`pad` → `error` | Ảnh nhỏ hơn khung: `keep` giữ cỡ nhỏ · `skip` không tạo output (status `skipped`, kèm lý do) · `pad` đệm nền · `error` báo lỗi |
| `upscale` | `false` | Cho phép phóng to ảnh nhỏ |
| `position` | `center` | Điểm crop cho `cover`: `center`, `top`, `attention` |
| `background` | trắng cho JPG, trong suốt cho PNG/WebP/AVIF | Màu nền khi `pad` hoặc khi làm phẳng ảnh trong suốt sang JPG, dạng `#rrggbb` |
| `sharpen` | tắt | Sigma 0.3–10, sharpen sau khi giảm cỡ |
| `stripMetadata` | `true` | Bỏ EXIF/GPS/XMP/ICC và chuyển sRGB |
| `jpeg.progressive` | `true` | JPEG progressive |
| `png` | `{ "compressionLevel": 6, "palette": false }` | |
| `keepSmallerSource` | `true` | Output cùng định dạng, cùng kích thước mà nặng hơn ảnh gốc → dùng ảnh gốc, kèm `W_OUTPUT_LARGER`; chỉ khi ảnh gốc không có metadata/ICC, orientation 1, sRGB và output không có watermark |
| `prefix` | `""` | Tiền tố tên file, dùng qua `{prefix}` |
| `watermark` | không | Tên một mục trong `watermarks` |

### Watermark

Logo gắn **sau** khi resize. Logo scale đều (không méo, không bị cắt) theo chiều rộng output, chiều cao theo tỉ lệ của logo.

| Trường | Mặc định | Ý nghĩa |
|---|---|---|
| `file` | (bắt buộc) | Ảnh logo, nên là PNG có alpha. Đường dẫn tương đối theo `imgfit.json` |
| `position` | `bottom-right` | `top-left`, `top`, `top-right`, `left`, `center`, `right`, `bottom-left`, `bottom`, `bottom-right` |
| `offset` | `["2%", "2%"]` | Khoảng cách `[x, y]` tới cạnh neo: `%` chiều rộng/cao output hoặc `px` |
| `width` | `"15%"` | Chiều rộng logo: `%` chiều rộng output hoặc `px`. Logo quá lớn được thu nhỏ đều cho vừa ảnh |
| `minOutput` | không | `[w, h]`: output nhỏ hơn ở một trong hai chiều thì không gắn (cảnh báo `W_WATERMARK_SKIPPED`) |
| `opacity` | `1` | 0–1 |

Report ghi vị trí và kích thước logo trên từng output (`"watermark": {"name", "left", "top", "width", "height"}`), hoặc lý do bỏ qua (`{"name", "skipped"}`).

## Lệnh `resize`

```bash
imgfit resize <file|thư mục|glob…> (--preset <tên,…> | --size <WxH>) -o <thư mục> [tùy chọn]
```

| Tùy chọn | Ý nghĩa |
|---|---|
| `-p, --preset L,LL,O` | Preset trong `imgfit.json`; mỗi input ra một output cho mỗi preset |
| `-c, --config <file>` | Đường dẫn `imgfit.json` |
| `-s, --size <WxH>` | Kích thước khung khi không dùng preset (`1600x1200`, hoặc `512` cho ảnh vuông) |
| `-o, --output <dir>` | Thư mục output (bắt buộc) |
| `-n, --name <template>` | Template tên, mặc định `{prefix}{name}.{ext}` |
| `-m, --mode`, `-f, --format`, `-q, --quality` | Như trong preset |
| `--keep png,webp` | Giữ định dạng input nếu nằm trong danh sách, ngược lại dùng `--format` |
| `--small-input`, `--upscale`, `--position`, `--focal x,y`, `--background`, `--sharpen [sigma]` | Như trong preset; `--focal` là focal point chuẩn hóa [0,1] cho `cover` |
| `--watermark <tên>` / `--no-watermark` | Gắn watermark từ `imgfit.json` / bỏ watermark của preset |
| `--keep-metadata`, `--no-progressive`, `--no-keep-smaller-source`, `--png-palette`, `--png-compression <0-9>` | |
| `-r, --recursive` | Quét thư mục con |
| `--overwrite` / `--skip-existing` | Đích đã tồn tại: thay / bỏ qua. Mặc định báo `E_OUTPUT_CONFLICT` và không ghi |
| `--backup`, `--backup-dir <dir>` | Sao lưu file cũ trước khi thay (mặc định `.imgfit/backups`) |
| `--max-pixels <n>` | Giới hạn số pixel input (mặc định ~268 MP) |
| `-j, --jobs <n>` | Số ảnh xử lý song song (mặc định 4) |
| `--dry-run` | Chỉ lập kế hoạch, không ghi gì |
| `--json`, `--report-json <file>`, `--quiet`, `--verbose` | Output máy / người đọc |

Khi dùng `--preset`, tùy chọn nào gõ trên dòng lệnh sẽ ghi đè preset (ví dụ `--preset L -f webp`); giá trị mặc định của CLI thì không.

**Placeholder trong template tên:** `{name}` (tên file nguồn, không đuôi), `{ext}` (đuôi theo định dạng output thật), `{w}` `{h}` (kích thước khung), `{preset}`, `{prefix}`, `{dir}` (thư mục con khi `-r`), `{hash}`.

`{hash}` là 16 ký tự hex đầu của SHA-256 nội dung output cuối cùng: cùng một ảnh luôn ra cùng một tên. Nếu tên đó đã tồn tại thì imgfit không ghi lại (status `skipped`, cảnh báo `W_SAME_CONTENT_EXISTS`) và report vẫn trả đúng tên. `{hash}` chỉ được nằm trong tên file, không trong thư mục. Khi `--dry-run`, tên vẫn còn nguyên `{hash}`.

Ghi file an toàn: encode ra file tạm cùng thư mục, đọc lại để xác minh định dạng và kích thước, rồi mới đổi tên vào đích. Trùng đích giữa các input (không phân biệt hoa/thường) hoặc đích trùng ảnh gốc thì dừng cả batch trước khi ghi. Không bao giờ ghi ra ngoài thư mục output, kể cả qua symlink.

## Lệnh `exec`

Chạy danh sách job do chương trình khác sinh ra (từ stdin hoặc file):

```bash
echo '{"schemaVersion":1,"jobs":[
  {"input":"upload/tmp/abc.jpg","output":"upload/out/{prefix}{hash}.{ext}","preset":"L"},
  {"input":"upload/tmp/abc.jpg","output":"upload/out/{prefix}{hash}.{ext}","preset":"LL"},
  {"input":"upload/tmp/x.png","output":"upload/out/x.webp","size":[256,256],"mode":"cover","format":"webp","watermark":null}
]}' | imgfit exec --stdin
imgfit exec --file job.json --report-json report.json
```

- Schema: `imgfit schema job`. Mỗi job có `input`, `output`, và `preset` hoặc `size`. Các trường khác của preset (`mode`, `format`, `quality`, `watermark`…) ghi đè preset. `"watermark": null` bỏ watermark của preset.
- `output` có placeholder thì là template (tương đối theo thư mục hiện tại), không có thì là đường dẫn file.
- Cấp batch: `config`, `root` (mọi output phải nằm trong đây, mặc định thư mục hiện tại), `onConflict`, `concurrency`, `dryRun`.
- stdout là **NDJSON**, mỗi dòng một JSON: `{"type":"progress",…}`, `{"type":"result",…}` (một FileResult), cuối cùng `{"type":"summary",…}`. Lỗi trước khi chạy (job sai, không có config) cũng in JSON trên stdout.

## Các lệnh khác

```bash
imgfit init [--force]                 # imgfit.json mẫu + imgfit.schema.json; không ghi đè nếu không --force
imgfit info <file> [--json]           # định dạng thật, kích thước sau EXIF, alpha, không gian màu
imgfit capabilities [--json]          # định dạng bản build này hỗ trợ + version sharp/libvips
imgfit schema config|result|info|job  # JSON Schema để validate hoặc sinh type
imgfit ui [--root <dir>] [--port <n>] [--open]
imgfit --version [--json]
```

## Report JSON, exit code, mã lỗi

Với `--json`, stdout chỉ chứa JSON (log ghi ra stderr). Schema: `imgfit schema result`.

```json
{
  "schemaVersion": 2,
  "tool": { "name": "imgfit", "version": "0.1.0", "sharp": "0.35.5", "libvips": "8.18.7" },
  "command": "resize",
  "status": "ok",
  "dryRun": false,
  "summary": { "total": 2, "processed": 1, "created": 1, "replaced": 0, "planned": 0, "skipped": 1, "failed": 0, "cancelled": 0, "inputBytes": 2349105, "outputBytes": 168034, "bytesSaved": 2181071 },
  "files": [
    {
      "file": "upload/abc.jpg", "destination": "upload/out/L_abc.jpg", "status": "created", "action": "create", "preset": "L",
      "format": "jpg", "inputBytes": 2349105, "outputBytes": 168034, "inputPx": [3000, 2000], "outputPx": [640, 427],
      "elapsedMs": 46, "watermark": null, "fingerprint": "sha256:…", "warnings": [], "errors": []
    },
    {
      "file": "upload/abc.jpg", "destination": null, "status": "skipped", "preset": "LL", "outputPx": null,
      "warnings": [{ "code": "W_SMALL_INPUT_SKIPPED", "message": "…", "details": { "source": [300, 200], "target": [1600, 1200] } }]
    }
  ],
  "errors": [],
  "warnings": []
}
```

- `status` của file: `created`, `replaced`, `skipped` (cố ý không ghi, lý do trong `warnings`), `failed`, `cancelled`, `planned` (dry-run).
- `status` của report: `ok`, `failed` (có file lỗi), `aborted` (dừng trước khi ghi, ví dụ trùng đích), `cancelled`.
- Lỗi xảy ra trước khi chạy (tham số sai, không có config…) cho ra `{"status": "error", "errors": [...]}`.

**Exit code:** `0` ok · `1` có file lỗi hoặc batch bị dừng · `2` tham số/config sai, input không tồn tại · `3` lỗi môi trường (quyền, đĩa đầy, lỗi nội bộ) · `130` bị hủy (Ctrl+C).

**Mã lỗi (`E_*`):**

| Mã | Khi nào |
|---|---|
| `E_USAGE` | Tham số, job hoặc preset sai |
| `E_CONFIG_NOT_FOUND` / `E_CONFIG_INVALID` | Không có `imgfit.json` / config sai (kể cả logo watermark không đọc được); `details.problems` liệt kê từng lỗi |
| `E_INPUT_NOT_FOUND` | Input hoặc glob không tồn tại |
| `E_INPUT_UNSUPPORTED` / `E_INPUT_CORRUPT` / `E_INPUT_ANIMATED` / `E_INPUT_TOO_LARGE` | Input không hỗ trợ / hỏng / ảnh động / vượt giới hạn pixel |
| `E_SMALL_INPUT` | Ảnh nhỏ hơn khung và `smallInput: error` |
| `E_FORMAT_UNSUPPORTED` | `format: keep` với GIF/TIFF |
| `E_EXTENSION_MISMATCH` | Đuôi trong template không khớp định dạng output (dùng `{ext}`) |
| `E_OUTPUT_CONFLICT` | Đích đã tồn tại (hoặc là thư mục) |
| `E_OUTPUT_COLLISION` / `E_OUTPUT_SAME_AS_SOURCE` | Nhiều input cùng đích / đích trùng ảnh gốc: cả batch dừng |
| `E_OUTPUT_INVALID` | Output encode xong nhưng sai định dạng/kích thước: không ghi |
| `E_PATH_UNSAFE` | Đích nằm ngoài thư mục output (kể cả qua symlink) |
| `E_PERMISSION` / `E_DISK_FULL` / `E_WRITE_FAILED` | Lỗi hệ thống file |
| `E_FORBIDDEN` / `E_NOT_FOUND` | Web UI: bị chặn / không tồn tại |
| `E_CANCELLED` / `E_INTERNAL` | Bị hủy / lỗi không phân loại (báo lại kèm `--verbose`) |

**Mã cảnh báo (`W_*`):**

| Mã | Ý nghĩa |
|---|---|
| `W_ALPHA_FLATTENED`, `W_DEFAULT_BACKGROUND` | Ảnh trong suốt đã làm phẳng khi xuất JPG / đã dùng nền trắng mặc định |
| `W_SMALL_INPUT_KEPT`, `W_SMALL_INPUT_PADDED`, `W_SMALL_INPUT_SKIPPED` | Ảnh nhỏ hơn khung: giữ cỡ nhỏ / đệm nền / bỏ qua preset |
| `W_OUTPUT_LARGER` | Output nặng hơn ảnh gốc cùng định dạng và kích thước; `details.usedSource` cho biết đã dùng ảnh gốc hay chưa, `details.reason` nói vì sao không dùng được |
| `W_SAME_CONTENT_EXISTS` | Tên theo `{hash}` đã tồn tại (cùng nội dung), không ghi lại |
| `W_WATERMARK_SKIPPED` | Không gắn watermark vì output nhỏ hơn `minOutput` |
| `W_SKIP_EXISTING_UNVERIFIED` | Bỏ qua vì đích đã có (`--skip-existing`); file cũ không được kiểm tra |
| `W_METADATA_KEPT` | Đang giữ metadata (có thể có GPS) |

Mã lỗi, mã cảnh báo, exit code, cấu trúc JSON và placeholder là hợp đồng công khai: chỉ thêm mới; muốn đổi nghĩa thì tăng `schemaVersion`.

## Gọi từ ngôn ngữ khác

Mọi ngôn ngữ gọi cùng một cách: chạy `imgfit … --json` (hoặc `imgfit exec`), đọc stdout là JSON, xem exit code. Truyền tham số dạng **mảng**, không ghép chuỗi qua shell.

Ví dụ chạy được trong [examples/](examples/): Python ([resize.py](examples/python/resize.py)), PHP ([resize.php](examples/php/resize.php)), shell/PowerShell ([resize.sh](examples/shell/resize.sh), [resize.ps1](examples/shell/resize.ps1)). Node có thể import trực tiếp: `import { resize } from "imgfit"`.

Python:

```python
import json, shutil, subprocess

proc = subprocess.run(
    [shutil.which("imgfit"), "resize", "upload/abc.jpg", "--preset", "L,LL,O",
     "-o", "upload/out", "--name", "{prefix}{hash}.{ext}", "--json"],
    capture_output=True, text=True, encoding="utf-8",
)
report = json.loads(proc.stdout)          # với --json, stdout luôn là JSON kể cả khi lỗi
for f in report.get("files", []):
    if f["status"] in ("created", "skipped") and f["destination"]:
        print(f["preset"], f["destination"])   # key để upload và lưu DB
```

**Windows:** lệnh `imgfit` cài qua npm là file `.cmd`. Python cần đường dẫn đầy đủ (`shutil.which("imgfit")` trả về `…\imgfit.CMD`); PHP `proc_open` cần gọi `imgfit.cmd`. Nếu tham số có ký tự đặc biệt của `cmd.exe` (`%`, `^`, `&`), gọi thẳng `node <thư mục cài>/dist/bin.js …`.

**Độ trễ:** mỗi lần gọi CLI tốn khoảng 300 ms (khởi động Node, nạp sharp, một ảnh 6 MP → 640×480), trong đó xử lý ảnh chỉ khoảng 50 ms. Khi cần nhiều bản từ một ảnh, gọi **một lần** với nhiều preset (`--preset L,LL,O`) hoặc một `exec` nhiều job, thay vì gọi nhiều lần.

## Lưu ý cho bên upload (R2/CDN)

imgfit không upload, nhưng cách đặt tên và chọn preset ảnh hưởng trực tiếp tới số request lên storage.

**R2 tính tiền thế nào:**

- R2 tính theo **số lần thao tác chạm tới bucket**. Class A gồm ghi, list, copy; Class B gồm đọc (GET, HEAD). Gói free có hạn mức Class A/B mỗi tháng (kiểm tra bảng giá hiện tại trên trang Cloudflare). Băng thông ra (egress) không tính tiền.
- **Request được CDN Cloudflare trả từ cache thì không chạm R2**, nên không tốn. Nguyên tắc: để ảnh được cache, và đừng tạo URL mới cho cùng một ảnh (không gắn `?t=time()` hay query ngẫu nhiên).
- Request trả về **404 vẫn tính** là một lần đọc, và 404 thường không được cache.
- `*.workers.dev` **không có cache ở edge**: mỗi lượt xem ảnh qua đó là một lần gọi Worker cộng một lần đọc R2.

**Áp dụng với imgfit:**

- Luôn xin preset nhỏ (`L`) kèm bản lớn, để danh sách/thumbnail không phải tải ảnh lớn. imgfit không tự thêm preset mà bên gọi không yêu cầu.
- Dùng `{hash}` trong tên file (ví dụ `"{prefix}{hash}.{ext}"`): cùng một ảnh luôn ra cùng một key. Trước khi upload, kiểm tra key đã có trong **DB của bạn** chưa; có rồi thì bỏ qua, không tốn thêm một lần ghi (Class A) hay dung lượng. Đừng dùng `HeadObject` để kiểm tra, vì mỗi lần như vậy là một request Class B.
- Bên upload đặt `Cache-Control` (ví dụ `public, max-age=31536000, immutable`) và giữ nguyên tắc "đổi nội dung thì đổi tên" (`{hash}` làm việc này tự động).
- Ảnh nhẹ hơn không giảm số request, nhưng giảm dung lượng lưu trữ và giúp trang tải nhanh hơn. Đó là lý do có WebP/AVIF theo preset và `keepSmallerSource`.
- Report trả đúng tên file của từng preset (`destination`), nên lưu key theo report thay vì tự đoán tên.

## Web UI

```bash
imgfit ui --open                      # dùng preset trong ./imgfit.json nếu có
imgfit ui --root ../config-dir --port 8765
```

Kéo thả ảnh, chọn preset (từ `imgfit.json` hoặc dựng sẵn) hoặc tự chỉnh, xem trước bằng thanh so sánh trước/sau, đặt focal point cho `cover`, xử lý rồi tải từng file hoặc ZIP. UI chỉ làm việc với file trên máy, không đọc storage.

Server chỉ dành cho máy của bạn: chỉ listen `127.0.0.1`, chặn `Host` lạ (DNS rebinding), URL có token dùng một lần đổi thành cookie `HttpOnly; SameSite=Strict`, request ghi cần `Origin` cùng gốc và header `X-Imgfit-CSRF`, không có API nhận đường dẫn tùy ý, upload tối đa 50 MB/file và được kiểm tra nội dung bằng sharp, thư mục tạm riêng cho mỗi phiên và được dọn khi tắt.

## Giới hạn

- Input: JPEG, PNG, WebP, AVIF, TIFF, GIF tĩnh (xác định theo nội dung file). Không hỗ trợ ảnh động (GIF/APNG/WebP nhiều frame), HEIC, RAW, PDF.
- Output: JPEG, PNG, WebP, AVIF.
- Mặc định giới hạn ~268 MP mỗi ảnh (`--max-pixels` để đổi).
- Encode AVIF chậm hơn JPEG 3–6 lần.

## Phát triển

```bash
npm ci
npm run build          # dọn dist/ → core (tsc) + UI (vite)
npm test               # vitest: unit, integration, behavior (ảnh mẫu tự sinh), API server, hợp đồng JSON
npm run typecheck      # tsc + vue-tsc
npm run bench          # build + benchmark
npm run smoke          # npm pack → cài vào project trống → gọi CLI + Node API
npm run docker         # docker build
node scripts/samples.mjs <dir> [--huge]                       # sinh bộ ảnh mẫu
node scripts/compare/compare.mjs && node scripts/compare/report.mjs   # so sánh với Intervention/imgproxy (cần Docker)
```

Chạy `vitest` từ PowerShell/cmd trên Windows (từ Git Bash vitest có thể lỗi lúc nạp).

Cấu trúc theo lớp, lớp dưới không import lớp trên: `core` ← `image` ← `io` ← `pipeline` ← `config` ← `commands` ← `cli` / `server`.

```text
src/
├── bin.ts            # entry lệnh `imgfit` (SIGINT, stdin)
├── index.ts          # Node API công khai
├── core/             # errors, exit, report, paths, template, fingerprint
├── image/            # một ảnh: geometry, formats, options, probe, plan (thuần), watermark, encode, sharp
├── io/               # inputs (file/thư mục/glob), publish (ghi an toàn), fs, zip
├── pipeline/         # job (prepare → encode → xác minh → publish), batch, smaller-source, content-name ({hash})
├── config/           # imgfit.json: types, find, load (preset + watermark), validate, variants (preset + override)
├── commands/         # resize, exec, info, init
├── cli/              # main, context, format, options, parsers, commands/
└── server/           # web UI cục bộ: app, security, sessions, batches (SSE), upload, previews, routes/
ui/                   # Vue 3 + Vite
schema/               # JSON Schema công khai: config, result, info, job
scripts/              # samples, compare/, bench, smoke-package
test/{unit,integration,behavior}/
```

Quy ước: mọi thay đổi làm khác bytes output với cùng input và tùy chọn phải tăng `PIPELINE_VERSION` trong [src/core/fingerprint.ts](src/core/fingerprint.ts). Test chỉ dùng ảnh tự sinh, không commit ảnh có bản quyền.
