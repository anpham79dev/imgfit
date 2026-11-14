# imgfit

Công cụ **resize, chuyển định dạng, chuẩn hóa và kiểm tra ảnh** trước khi đưa vào repository, dùng cho mọi dự án: web, mobile, game, tài liệu… Lõi xử lý viết bằng Node.js + [sharp](https://sharp.pixelplumbing.com/) (libvips). **Ngôn ngữ nào cũng dùng được** thông qua CLI có output JSON ổn định: Python, PHP/Laravel, C#/Unity, shell, CI… Node có thêm API để import trực tiếp. Có web UI chạy cục bộ để xem trước, chọn điểm crop và đặt tên hàng loạt.

```bash
imgfit init --profile web      # tạo imgfit.json
imgfit run                     # xử lý phần thay đổi (incremental)
imgfit check                   # kiểm tra read-only cho CI / pre-commit
imgfit ui                      # web UI cục bộ
imgfit resize "raw/**/*.{jpg,png}" -s 256x256 -m cover -f webp -o out/   # dùng ngay, không cần config
```

Nguyên tắc thiết kế:

- **Không bao giờ làm mất dữ liệu.** Không đè file lạ, không sửa ảnh gốc, phát hiện trùng đích trước khi ghi, phát hiện output bị sửa tay.
- **Kết quả tái lập được.** Dry-run báo đúng thứ sẽ ra. Cùng nguồn, preset và version thì cho cùng bytes, kể cả giữa Windows và Linux.
- **An toàn mặc định.** Không phóng to, bỏ metadata, không âm thầm xử lý ảnh động, web UI chỉ nghe trên `127.0.0.1`.

---

## Mục lục

- [Cài đặt](#cài-đặt)
- [Bắt đầu trong 5 phút](#bắt-đầu-trong-5-phút)
- [Dự án với `imgfit.json`](#dự-án-với-imgfitjson)
  - [Cấu hình](#cấu-hình)
  - [`imgfit run`: incremental](#imgfit-run-incremental)
  - [Áp vào dự án đã có ảnh: `--adopt`](#áp-vào-dự-án-đã-có-ảnh---adopt)
  - [Đặt tên theo id, focal point](#đặt-tên-theo-id-focal-point)
  - [`imgfit check`: CI và pre-commit](#imgfit-check-ci-và-pre-commit)
  - [Các file trạng thái](#các-file-trạng-thái)
- [Lệnh `resize`](#lệnh-resize)
- [Hành vi xử lý ảnh](#hành-vi-xử-lý-ảnh)
  - [Chế độ resize](#chế-độ-resize)
  - [Ảnh nhỏ hơn kích thước đích](#ảnh-nhỏ-hơn-kích-thước-đích)
  - [Điểm crop và focal point](#điểm-crop-và-focal-point)
  - [Định dạng, alpha, metadata](#định-dạng-alpha-metadata)
  - [Đặt tên output](#đặt-tên-output)
  - [Ghi file an toàn](#ghi-file-an-toàn)
- [Web UI](#web-ui)
- [`imgfit exec`: job JSON từ chương trình khác](#imgfit-exec-job-json-từ-chương-trình-khác)
- [Các lệnh khác](#các-lệnh-khác)
- [Output JSON, exit code, mã lỗi](#output-json-exit-code-mã-lỗi)
- [Tích hợp từ ngôn ngữ khác](#tích-hợp-từ-ngôn-ngữ-khác)
- [Hiệu năng](#hiệu-năng)
- [Giới hạn](#giới-hạn)
- [FAQ](#faq)
- [Phát triển](#phát-triển)

---

## Cài đặt

Có ba cách: qua npm, bản portable (không cần cài Node), hoặc Docker.

### npm (máy có Node.js ≥ 20.15)

```bash
# Từ file .tgz đã đóng gói (khuyến nghị cho nội bộ)
npm run build && npm pack                          # trong repo imgfit → imgfit-<version>.tgz
npm install -D /đường/dẫn/imgfit-<version>.tgz     # trong dự án dùng nó

# Từ Git, nhớ pin tag hoặc commit
npm install -D git+https://<git-host>/<org>/imgfit.git#v<version>
```

Chạy bằng `npx imgfit …` hoặc thêm vào `package.json`: `"images": "imgfit run"`, `"images:check": "imgfit check"`.

sharp tự tải binary libvips dựng sẵn cho Windows, Linux (glibc/musl, x64/arm64) và macOS. Môi trường đặc biệt (máy không có mạng, ARM cũ) xem [hướng dẫn cài sharp](https://sharp.pixelplumbing.com/install/).

> Cài từ Git cần build ở máy người cài. Dùng `.tgz` đã build sẵn để tránh việc đó.

### Bản portable (máy không có Node)

Mỗi nền tảng có một file nén chứa sẵn Node, imgfit và libvips:

```text
imgfit-<version>-<platform>-<arch>/
├── imgfit.cmd     # Windows (cmd)        ├── imgfit.ps1   # Windows PowerShell
├── imgfit         # Linux / macOS (sh)
├── node(.exe)     # Node gốc, giữ nguyên chữ ký số
└── app/           # imgfit + node_modules production
```

Giải nén ở đâu cũng được, rồi gọi `imgfit.cmd` / `./imgfit`, hoặc đặt `IMGFIT_BIN` trỏ tới file đó. Khi gọi từ chương trình khác mà không muốn qua shim, gọi trực tiếp `[<bundle>/node(.exe), <bundle>/app/dist/bin.js, ...tham số]`.

Tự build cho nền tảng đang dùng: `npm run portable` (ra `release/`). Muốn có bản cho nền tảng khác thì phải build trên chính nền tảng đó (CI matrix trong [.github/workflows/ci.yml](.github/workflows/ci.yml)), vì sharp tải binary theo OS/CPU.

> `node scripts/build-portable.mjs --sea` tạo thêm một file thực thi duy nhất (Node SEA). Trên Windows, file này **phải được code-sign**, nếu không Smart App Control / AppLocker sẽ chặn chạy. Vì vậy bản mặc định giữ nguyên `node.exe` gốc đã có chữ ký.

### Docker

```bash
docker build -t imgfit:<version> .
docker run --rm -v "$PWD:/work" --user "$(id -u):$(id -g)" imgfit:<version> run
docker run --rm -v "$PWD:/work" imgfit:<version> check --check-mode output-only
```

Thêm `--user` để file output thuộc về bạn chứ không phải root.

---

## Bắt đầu trong 5 phút

**Có dự án, muốn imgfit quản lý ảnh:**

```bash
imgfit init --profile web       # tạo imgfit.json, imgfit.schema.json, thêm .imgfit/ vào .gitignore
# đặt ảnh gốc vào images-src/photos/… (hoặc sửa roots.input trong imgfit.json)
imgfit run --dry-run            # xem trước: create / replace / unchanged
imgfit run                      # xử lý
imgfit run                      # lần hai: "3 không đổi", không encode lại
imgfit check                    # kiểm tra read-only
git add imgfit.json imgfit.managed.json public/images
```

**Chỉ cần resize một thư mục:**

```bash
imgfit info raw/photo.jpg                                          # định dạng thật, kích thước sau EXIF, alpha
imgfit resize raw/ -r -s 256x256 -m cover -f webp -o out/ --dry-run
imgfit resize raw/ -r -s 256x256 -m cover -f webp -o out/
```

**Thích giao diện:** `imgfit ui`, rồi mở URL được in ra.

Output dạng dễ đọc:

```text
NEW   images-src/photos/trip/a.jpg → public/images/hero/trip/a.jpg  3000×2000 → 1620×1080  2.1 MB → 210.4 KB
NEW   images-src/photos/trip/a.jpg → public/images/thumb/trip/a.webp  3000×2000 → 256×256  2.1 MB → 9.8 KB
FAIL  images-src/logos/tiny.png → ?  100×80 → ?  3.1 KB → unknown
      ✗ E_SMALL_INPUT: Ảnh nguồn 100×80 nhỏ hơn target 256×256 (mode cover); không phóng to. …

FAILED: 3 file · 2 tạo mới, 0 thay thế · 0 bỏ qua · 1 lỗi · tiết kiệm 1.89 MB · 0.21s
```

Dùng trong script hoặc từ ngôn ngữ khác thì thêm `--json`. Khi đó stdout chỉ chứa một document JSON (xem [Output JSON](#output-json-exit-code-mã-lỗi)).

---

## Dự án với `imgfit.json`

### Cấu hình

`imgfit.json` nằm ở gốc dự án. **Mọi đường dẫn tương đối tính theo thư mục chứa file này.** imgfit tìm config theo thứ tự: `--config <file>`, rồi `IMGFIT_CONFIG`, rồi đi ngược từ thư mục hiện tại lên các thư mục cha.

```json
{
  "$schema": "./imgfit.schema.json",
  "schemaVersion": 1,
  "profile": "web",
  "env": ["IMG_SOURCE_DIR"],
  "roots": { "input": "${IMG_SOURCE_DIR}", "output": "public/images" },
  "defaults": { "upscale": false, "stripMetadata": true, "onConflict": "error", "jobs": 4 },
  "presets": {
    "hero":  { "size": [1920, 1080], "mode": "fit", "format": "jpg", "quality": 85 },
    "thumb": { "size": [256, 256], "mode": "cover", "crop": { "position": "attention" }, "format": "webp", "maxFileKB": 40 },
    "logo":  { "size": [256, 256], "mode": "fit", "format": "png" }
  },
  "rules": [
    { "id": "photos",  "from": "photos/**/*.{jpg,jpeg,png,webp}", "preset": ["hero", "thumb"], "to": "{preset}/{dir}/{name}.{ext}" },
    { "id": "avatars", "from": "avatars/*.{jpg,png}", "exclude": ["**/draft-*"], "preset": "thumb", "to": "avatars/{id}.{ext}", "names": "imgfit.names.json" },
    { "id": "logos",   "from": "logos/*.png", "preset": "logo", "to": "logos/{name}.{ext}" }
  ],
  "budget": { "maxFileKB": 1024 }
}
```

| Khóa | Ý nghĩa |
|---|---|
| `schemaVersion` | Luôn là `1` |
| `profile` | `generic` \| `web` \| `unity`. Chỉ là bộ mặc định và whitelist định dạng output: generic/web cho jpg, png, webp, avif; unity cho jpg, png. Không có logic riêng theo framework |
| `env` | Danh sách biến môi trường được phép dùng dạng `${VAR}` trong `roots`. Biến chưa khai báo hoặc chưa đặt → `E_CONFIG_INVALID`. imgfit không bao giờ chạy lệnh shell hay đánh giá code từ config |
| `roots.input` | Thư mục ảnh gốc. Khuyến nghị đặt **ngoài repo** và trỏ tới qua biến môi trường |
| `roots.output` | Gốc output. Không output nào được ghi ra ngoài thư mục này |
| `defaults` | `upscale`, `stripMetadata`, `onConflict` (`error`/`replace`/`skip`), `jobs`, `smallInput`, `background`, `quality` áp cho mọi preset |
| `presets.<tên>` | `size: [w, h]` (bắt buộc), `mode`, `format`, `quality`, `upscale`, `smallInput`, `crop.position` (`center`/`top`/`attention`), `background`, `sharpen` (sigma), `stripMetadata`, `png: {compressionLevel, palette}`, `blockMultiple`, `maxFileKB` |
| `rules[]` | `id` (duy nhất), `from` (glob hoặc mảng glob, tương đối theo `roots.input`), `exclude`, `preset` (tên hoặc mảng), `to` (template tương đối theo `roots.output`), `names` (file mapping cho `{id}`) |
| `budget.maxFileKB` | Ngân sách dung lượng mặc định cho mỗi output; `check` báo `E_BUDGET_EXCEEDED` khi vượt |
| `cache.path` / `cropOverrides.path` / `managed.path` | Đổi vị trí các file trạng thái (mặc định `.imgfit/cache.json`, `imgfit.crops.json`, `imgfit.managed.json`) |

Config được validate bằng JSON Schema ([schema/config.schema.json](schema/config.schema.json), hoặc `imgfit schema config`). Ngoài ra imgfit còn kiểm tra ngữ nghĩa:

- Không có khóa lạ, và rule không trỏ tới preset không tồn tại.
- Rule có nhiều preset thì `to` phải chứa `{preset}`.
- Dùng `{id}` thì rule phải khai báo `names`.
- Glob không được chứa `..` hay đường dẫn tuyệt đối.
- `format` phải nằm trong whitelist của profile.
- Với `blockMultiple`, kích thước `cover`/`pad` phải là bội số.

VS Code và các IDE đọc `"$schema"` để gợi ý và báo lỗi ngay khi bạn gõ.

**Thứ tự ưu tiên:** tham số CLI > biến môi trường `IMGFIT_*` (`IMGFIT_JOBS`, `IMGFIT_CONFIG`) > `imgfit.json` > mặc định của profile > mặc định của tool.

Đặt biến môi trường cho `roots.input`:

```powershell
$env:IMG_SOURCE_DIR = "D:\art-source\project"      # PowerShell
```
```bash
export IMG_SOURCE_DIR=/mnt/d/art-source/project      # bash / WSL
```

**Pin version:** ghi version imgfit vào file `.imgfit-version` ở gốc dự án. Nếu đang chạy bản khác, imgfit cảnh báo `W_VERSION_MISMATCH`. Version sharp/libvips nằm trong fingerprint, nên đổi version thì output được tạo lại.

### `imgfit run`: incremental

Với mỗi cặp (nguồn × preset) của mỗi rule, `run` quyết định như sau:

| Tình huống | Hành động |
|---|---|
| Đích chưa có | **create** |
| Đích do imgfit quản lý, nguồn, preset, focal point và version engine **không đổi**, output không bị sửa | **unchanged**: không encode |
| Đích do imgfit quản lý, có thứ đã đổi | **replace** |
| Output đã bị sửa ngoài imgfit | `E_OUTPUT_MODIFIED`: không đè. `--overwrite` để tạo lại (kèm cảnh báo) |
| Đích có sẵn nhưng **chưa** do imgfit quản lý | `E_OUTPUT_CONFLICT`: gợi ý `--adopt` hoặc `--overwrite` |
| Hai input/rule cùng ra một đích, hoặc đích trùng nguồn | **Cả batch dừng, không ghi file nào** |

"Do imgfit quản lý" được xác định qua `imgfit.managed.json` (file được commit), **không dựa vào cache**. Vì vậy clone repo trên máy khác hoặc xóa `.imgfit/` không làm imgfit nhận nhầm output của chính nó là file lạ.

```bash
imgfit run                  # incremental
imgfit run --dry-run        # in action cho từng file, không ghi gì (không cả cache/lock)
imgfit run --overwrite      # thay cả output chưa quản lý / đã bị sửa tay
imgfit run --backup         # sao lưu bản cũ vào .imgfit/backups/<lần-chạy>/ trước khi thay
imgfit run --skip-existing  # bỏ qua output có sẵn chưa quản lý (KHÔNG kiểm tra)
imgfit run --watch          # chạy rồi theo dõi: nguồn đổi → xử lý đúng file đó; imgfit.json/names/crops đổi → chạy lại toàn bộ
imgfit run -j 8 --json --report-json report.json --report-html report.html
```

Ngoài ra, `run`:

- Cảnh báo **nguồn trùng nội dung** (`W_DUPLICATE_SOURCE`) và **output mồ côi**, tức output đang được quản lý nhưng không còn rule hay nguồn nào sinh ra (`W_OUTPUT_ORPHAN`). imgfit không tự xóa output mồ côi.
- Giữ một **lock theo dự án** (`.imgfit/locks/project.lock`), nên hai `run` không ghi cùng lúc (`E_LOCKED`). Lock của process đã chết hoặc quá 1 giờ được thay kèm cảnh báo.
- Ghi `imgfit.managed.json` **sau khi** output đã publish, và ghi định kỳ trong lúc chạy. Bị kill giữa chừng thì lần sau tiếp tục từ chỗ dừng.

### Áp vào dự án đã có ảnh: `--adopt`

Output đã có sẵn ở đúng đích rule nhưng chưa nằm trong `imgfit.managed.json` sẽ bị coi là file lạ. Để nhận chúng vào diện quản lý:

```bash
imgfit run --adopt          # liệt kê và hỏi xác nhận (trong terminal)
imgfit run --adopt --yes    # CI / script
imgfit run                  # lần đầu sau adopt: tạo lại từ nguồn (replace), giữ nguyên đường dẫn
```

Adopt **không encode và không sửa ảnh**, chỉ ghi hash của file hiện có. Chỉ những file nằm đúng đích do rule sinh ra mới được adopt. Ghi ảnh mới vào cùng đường dẫn không đụng tới file phụ của framework, nên Unity giữ nguyên `.meta`/GUID.

### Đặt tên theo id, focal point

**`{id}` theo `imgfit.names.json`** (commit được):

```json
{ "schemaVersion": 1, "names": { "avatars/IMG_0012.jpg": "hero-001", "avatars/IMG_0013.jpg": "hero-002" } }
```

Khóa là đường dẫn nguồn tương đối theo `roots.input`. Nguồn chưa có id sẽ báo `E_NAME_MISSING`; id trùng nhau sẽ làm trùng đích và dừng cả batch. File này soạn tay, sinh bằng script ở bất kỳ ngôn ngữ nào, hoặc dùng mục **Đặt tên theo id** trong web UI (dán danh sách id, xem trước mapping, kiểm tra trùng/thiếu/dư).

**Focal point theo `imgfit.crops.json`** (commit được), áp cho mọi preset `cover` của nguồn đó:

```json
{ "schemaVersion": 1, "crops": { "avatars/IMG_0012.jpg": { "x": 0.5, "y": 0.32 } } }
```

Đổi focal point làm fingerprint đổi, nên `run` sẽ tạo lại đúng các output liên quan. Cách dễ nhất là chọn focal point trong web UI bằng cách click lên ảnh.

### `imgfit check`: CI và pre-commit

`check` **chỉ đọc**. Lệnh không encode vào dự án, không ghi cache, managed hay crops, và không lấy lock.

| `--check-mode` | Cần | Kiểm tra |
|---|---|---|
| `standard` *(mặc định)* | nguồn + output | Output tồn tại; bytes đúng định dạng và khớp đuôi; kích thước đúng **chính xác** theo kế hoạch; ngân sách KB; whitelist của profile; không bị sửa tay; **không stale** (nguồn, preset, focal hoặc engine đổi mà chưa `run` lại) |
| `output-only` | output + `imgfit.managed.json` | Như trên trừ stale (không có nguồn). **Không chứng minh crop đúng** hay nguồn chưa đổi. Dùng cho CI chỉ có repo |
| `reproducible` | nguồn + output | `standard` + encode lại vào thư mục tạm và so checksum với output trong repo |

```bash
imgfit check                                   # exit 1 nếu có file fail
imgfit check --strict                          # cảnh báo (vd. output chưa quản lý) cũng tính là fail
imgfit check --check-mode output-only --json --report-json imgfit-report.json
imgfit check src/img/a.jpg public/images/a.webp  # chỉ kiểm tra file liên quan (pre-commit)
```

Khi lọc theo đường dẫn mà danh sách có `imgfit.json`, `imgfit.names.json`, `imgfit.crops.json` hoặc `imgfit.managed.json`, imgfit kiểm tra **toàn bộ**, để không bỏ sót rule vừa đổi.

- Hook pre-commit mẫu: [examples/hooks/pre-commit](examples/hooks/pre-commit). Hook chỉ kiểm tra file đang staged.
- GitHub Actions cho dự án dùng imgfit: [examples/ci/github-actions.yml](examples/ci/github-actions.yml).

### Các file trạng thái

| File | Commit? | Vai trò |
|---|---|---|
| `imgfit.json` | ✔ | Cấu hình |
| `imgfit.schema.json` | ✔ | Schema cho IDE (do `imgfit init` tạo, đúng version) |
| `imgfit.managed.json` | ✔ | Output nào do imgfit quản lý: rule, preset, nguồn, fingerprint, hash. Dùng để quyết định conflict, phát hiện sửa tay, stale |
| `imgfit.names.json` | ✔ | Nguồn → id cho `{id}` (dữ liệu người dùng) |
| `imgfit.crops.json` | ✔ | Nguồn → focal point (dữ liệu người dùng) |
| `.imgfit-version` | ✔ | Version imgfit dự án dùng (tùy chọn) |
| `.imgfit/cache.json` | ✘ | Chữ ký nhanh size + mtime → hash, để khỏi hash lại output mỗi lần. **Xóa được bất cứ lúc nào**; cache hỏng thì được dựng lại (`W_STATE_REBUILT`), không bao giờ làm skip sai |
| `.imgfit/backups/`, `.imgfit/locks/` | ✘ | Backup khi `--backup`, lock khi `run` |

`imgfit init` thêm `.imgfit/` và `*.imgfit-*.tmp` vào `.gitignore`. Các file JSON được ghi nguyên tử (file tạm rồi rename) với key đã sắp xếp, nên diff trong git ổn định.

---

## Lệnh `resize`

Resize ad hoc, không cần config. Đường dẫn tương đối tính theo **thư mục hiện tại**.

```text
imgfit resize <inputs...> --size <WxH> --output <dir> [options]
```

Mỗi input có thể là:

| Loại | Ví dụ | Ghi chú |
|---|---|---|
| File | `raw/a.jpg` | Định dạng nhận theo **nội dung**, không theo đuôi |
| Thư mục | `raw/` | Quét các đuôi `jpg jpeg png webp avif tif tiff gif`. Thêm `--recursive` để quét cả thư mục con |
| Glob | `"raw/**/*.{jpg,png}"` | **Đặt trong ngoặc kép.** Luôn dùng `/`, kể cả trên Windows |

Có thể truyền nhiều input một lúc; file trùng tự được loại bỏ. Khi quét, imgfit không đi theo symlink.

| Tùy chọn | Mặc định | Ý nghĩa |
|---|---|---|
| `-s, --size <WxH>` | *(bắt buộc)* | `256x256`, `1920x1080`, hoặc `512` cho ảnh vuông |
| `-o, --output <dir>` | *(bắt buộc)* | Thư mục output. Được tạo nếu chưa có, trừ khi `--dry-run` |
| `-m, --mode <mode>` | `fit` | `fit` \| `cover` \| `pad` |
| `-f, --format <fmt>` | `keep` | `keep` \| `jpg` \| `png` \| `webp` \| `avif` |
| `-q, --quality <1-100>` | jpg 85, webp 82, avif 50 | PNG chỉ dùng khi `--png-palette` |
| `-n, --name <template>` | `{name}.{ext}` | Xem [Đặt tên output](#đặt-tên-output) |
| `-r, --recursive` | tắt | Quét thư mục con |
| `--position <pos>` | `center` | Cho `cover`: `center` \| `top` \| `attention` \| `focal` |
| `--focal <x,y>` | — | Focal point `[0,1]`, vd. `0.5,0.3`. Tự bật `--position focal` |
| `--background <hex>` | trong suốt / `#ffffff` cho JPG | `#rgb`, `#rrggbb`, `#rrggbbaa` |
| `--small-input <p>` | fit: `keep`; cover/pad: `error` | `error` \| `keep` \| `pad` |
| `--upscale` | tắt | Cho phép phóng to |
| `--sharpen [sigma]` | tắt | Làm nét sau khi giảm cỡ (0.3–10, mặc định 1) |
| `--keep-metadata` | tắt | Giữ EXIF/XMP/ICC |
| `--png-palette` / `--png-compression <0-9>` | tắt / 6 | Tùy chọn PNG |
| `-j, --jobs <n>` | 4 | Số ảnh song song (1–64) |
| `--overwrite` / `--skip-existing` | tắt | Thay / bỏ qua output đã tồn tại (không dùng chung được) |
| `--backup`, `--backup-dir <dir>` | tắt, `.imgfit/backups` | Sao lưu trước khi thay |
| `--max-pixels <n>` | 268 402 689 | Chống ảnh "bom giải nén" |
| `--dry-run`, `--json`, `--report-json <f>`, `--report-html <f>`, `--quiet`, `--verbose` | | |

---

## Hành vi xử lý ảnh

Áp dụng như nhau cho `resize`, `run`, `exec` và web UI, vì tất cả dùng chung một engine.

### Chế độ resize

Mọi chế độ đều **xoay ảnh theo EXIF trước** (kể cả ảnh lật gương), rồi mới tính khung.

| Mode | Kết quả | Kích thước output |
|---|---|---|
| `fit` | Thu ảnh cho vừa khung, giữ tỷ lệ, không cắt | ≤ W×H |
| `cover` | Lấp kín khung, cắt bớt phần thừa | Đúng W×H |
| `pad` | Thu ảnh cho vừa khung rồi đệm nền cho đủ | Đúng W×H |

`blockMultiple: 4` (thường dùng cho texture nén khối BC/DXT):
- Với `fit`: kích thước được làm tròn **xuống** bội số, kèm cảnh báo `W_BLOCK_ROUNDED`.
- Với `cover`/`pad`: preset phải sẵn là bội số. imgfit không ngầm đổi kích thước preset.

### Ảnh nhỏ hơn kích thước đích

Mặc định imgfit **không phóng to**. Không thể vừa đảm bảo "đúng W×H" vừa "không phóng to", nên với ảnh nhỏ phải chọn rõ cách xử lý:

| `smallInput` | `fit` | `cover` | `pad` |
|---|---|---|---|
| `keep` | Giữ kích thước gốc *(mặc định)* | Chỉ crop về đúng tỷ lệ (`W_SMALL_INPUT_KEPT`) | Giữ kích thước gốc, không đệm |
| `error` | `E_SMALL_INPUT` | `E_SMALL_INPUT` *(mặc định)* | `E_SMALL_INPUT` *(mặc định)* |
| `pad` | Đệm nền lên W×H | Đệm nền lên W×H | Đệm nền lên W×H (`W_SMALL_INPUT_PADDED`) |

"Nhỏ" nghĩa là: với `cover`, một chiều nhỏ hơn đích là đủ; với `fit`/`pad`, phải cả hai chiều đều nhỏ hơn. Bật `upscale` thì không còn trường hợp ảnh nhỏ.

### Điểm crop và focal point

| Position | Hành vi |
|---|---|
| `center` | Giữ phần giữa *(mặc định)* |
| `top` | Giữ mép trên, hợp với chân dung |
| `attention` | Heuristic của libvips (vùng nổi bật). **Không phải nhận diện khuôn mặt** |
| `focal` | Giữ điểm `x,y` ở giữa khung nhiều nhất có thể, rồi clamp trong biên ảnh |

Tọa độ focal là tỷ lệ `[0,1]` trên **ảnh đã xoay theo EXIF**: `0,0` là góc trên trái, `1,1` là góc dưới phải.

### Định dạng, alpha, metadata

- **Input:** JPEG, PNG, WebP, AVIF, TIFF, GIF (một frame), nhận diện theo nội dung file.
- **Bị từ chối rõ ràng:** ảnh động GIF/APNG/WebP (`E_INPUT_ANIMATED`), HEIC (`E_INPUT_UNSUPPORTED`), file rỗng hoặc hỏng (`E_INPUT_CORRUPT`).
- **`format: keep`** giữ định dạng với JPEG/PNG/WebP/AVIF. TIFF/GIF báo `E_FORMAT_UNSUPPORTED`; khi đó hãy chọn định dạng cụ thể.
- **Alpha sang JPG:** flatten lên `background` (mặc định trắng), kèm `W_ALPHA_FLATTENED` (và `W_DEFAULT_BACKGROUND` nếu chưa đặt màu nền). PNG/WebP/AVIF giữ alpha; phần đệm của `pad` mặc định trong suốt.
- **Metadata:** mặc định bỏ EXIF (kể cả GPS), XMP, ICC và chuyển về sRGB. `stripMetadata: false` / `--keep-metadata` để giữ (kèm `W_METADATA_KEPT`).
- **Xác minh output:** sau khi encode, imgfit đọc lại file. Sai định dạng hoặc kích thước thì báo `E_OUTPUT_INVALID` và không publish. Đuôi file luôn khớp bytes thật (`E_EXTENSION_MISMATCH` nếu template đặt sai đuôi).

### Đặt tên output

| Placeholder | Giá trị |
|---|---|
| `{name}` | Tên nguồn không đuôi, đã làm sạch |
| `{ext}` | Đuôi theo **định dạng output thật** |
| `{w}`, `{h}` | Kích thước đích của preset |
| `{preset}` | Tên preset (bắt buộc khi rule có nhiều preset) |
| `{dir}` | Thư mục con tương đối theo phần tĩnh của glob. Là placeholder duy nhất được sinh ra `/` |
| `{id}` | ID từ file `names` của rule |

Để tên dùng được trên mọi hệ điều hành, imgfit tự làm sạch từng phần của đường dẫn:
- Chuẩn hóa Unicode về NFC.
- Thay ký tự cấm trên Windows (`<>:"/\|?*`) bằng `_`.
- Bỏ dấu chấm và khoảng trắng ở cuối.
- Tránh tên reserved: `CON` thành `_CON`.

Template bị từ chối nếu có `..`, là đường dẫn tuyệt đối, hoặc dùng placeholder lạ. Trùng đích được so **không phân biệt hoa/thường** và dạng Unicode, kể cả trên Linux, để repo dùng chung được với Windows/macOS.

### Ghi file an toàn

1. **Kiểm tra cả batch trước khi ghi.** Trùng đích hoặc đích trùng nguồn thì cả batch dừng (`status: "aborted"`), không file nào được ghi.
2. **Không đè file có sẵn**, trừ khi bạn chọn rõ. File mới được tạo bằng thao tác độc quyền (hard link, hoặc copy `COPYFILE_EXCL`), nên tiến trình khác vừa tạo cùng tên cũng không bị đè.
3. **File tạm** `.<tên>.imgfit-<ngẫu nhiên>.tmp` nằm cùng thư mục đích, bắt đầu bằng `.` để Unity, Vite, webpack bỏ qua. File tạm được xác minh rồi mới publish, và bị xóa nếu lỗi.
4. **Backup** nằm trong `.imgfit/backups/…`, **không bao giờ cạnh output**, nên không bị Unity import hay bị web server public.
5. **Không ghi ra ngoài thư mục output**, kể cả qua symlink hoặc junction: `realpath` được kiểm tra lại ngay trước khi ghi. Không ghi đè lên symlink.
6. **Windows:** file đang bị editor hoặc antivirus giữ (`EBUSY`/`EPERM`) thì imgfit retry có backoff, sau đó báo lỗi và giữ nguyên bản cũ. imgfit chỉ tắt cache *file handle* của libvips, vì cache này khóa file trên Windows.
7. **Không bao giờ sửa hoặc xóa ảnh nguồn.**
8. **Ctrl+C:** không bắt đầu ảnh mới, chờ các ảnh đang xử lý xong, ảnh đã ghi vẫn giữ, trạng thái được lưu. Exit 130. Nhấn Ctrl+C lần hai để thoát ngay.

> Thay file bằng `rename` là nguyên tử trên cùng filesystem ở Linux/macOS. imgfit không khẳng định điều này tuyệt đối trên Windows; nếu thay thất bại thì bản cũ được giữ.

---

## Web UI

```bash
imgfit ui                         # chế độ dự án nếu thư mục hiện tại có imgfit.json
imgfit ui --root ../my-project --port 8765 --open
```

Lệnh in ra một URL dạng `http://127.0.0.1:8765/?t=…`. Mở URL đó trong trình duyệt. Token chỉ dùng **một lần**: lần mở đầu tiên đổi token thành cookie phiên, nên đừng chia sẻ URL này.

**Resize nhanh** (không cần config):

- Kéo thả file hoặc cả thư mục, hoặc chọn file.
- Thumbnail được tải lười; không bao giờ nạp hàng trăm ảnh gốc full-size.
- Chọn preset (dựng sẵn hoặc lấy từ `imgfit.json`) hoặc tùy chỉnh.
- **Xem trước** với thanh so sánh trước/sau: preview được encode bằng đúng pipeline của output.
- Với `cover`, click lên ảnh để đặt **focal point**; khung hiển thị đúng vùng sẽ giữ lại.
- Xử lý với tiến độ theo từng ảnh, có **Hủy** và **Thử lại file lỗi**.
- Tải từng file hoặc tải **ZIP** (ZIP được stream, không gom vào RAM).

**Dự án** (khi có `imgfit.json`):

- Xem manifest (kết quả `run --dry-run`): action, lỗi, cảnh báo của từng output.
- Chọn một output để xem so sánh *output hiện tại ↔ sẽ ghi*, và chỉnh **focal point**. Lưu vào `imgfit.crops.json`.
- **Đặt tên theo id:** dán danh sách id (mỗi dòng một id theo thứ tự nguồn, hoặc `tên-file,id`). UI hiện mapping, báo trùng/thiếu/dư, không tự đoán khi mơ hồ. Lưu vào file `names` của rule.
- **Ghi vào dự án:** *Xem trước thay đổi* liệt kê tạo mới / thay thế / bị chặn. *Xác nhận ghi* chạy `run` (luôn kèm backup) với tiến độ trực tiếp.
  - Mỗi xác nhận gắn với hash của đúng kế hoạch đã review và hết hạn sau 5 phút.
  - Nếu dự án thay đổi giữa lúc xem và lúc xác nhận, server từ chối (`E_STALE_CONFIRMATION`) và bắt xem lại.

**Bảo mật** (server chỉ dành cho máy của bạn):

| Lớp | Cơ chế |
|---|---|
| Mạng | Chỉ listen `127.0.0.1`. Không có tùy chọn mở `0.0.0.0` |
| DNS rebinding | Chỉ chấp nhận `Host` là `127.0.0.1:<port>` hoặc `localhost:<port>` |
| Phiên | Token bootstrap dùng một lần → cookie `HttpOnly; SameSite=Strict`. Token không nằm lâu trong URL hay log |
| CSRF | Request ghi cần `Origin` cùng gốc **và** header `X-Imgfit-CSRF`. CORS tắt, preflight bị từ chối |
| Đường dẫn | Không có API nhận đường dẫn tùy ý. Ảnh dự án chỉ được đọc nếu thuộc manifest. ZIP chỉ chứa output của phiên, tên entry đã làm sạch |
| Upload | Tối đa 50 MB/file, 500 file/lần, 2 GB/phiên, 20 phiên. Kiểm tra nội dung bằng sharp (không tin tên/MIME). Từ chối khi ổ tạm sắp đầy |
| Header | CSP `default-src 'self'`, `X-Frame-Options: DENY`, `nosniff`, `no-referrer` |
| Dọn dẹp | Thư mục tạm riêng mỗi phiên (0700). Dọn khi idle 2 giờ, khi tắt server, và dọn phần còn sót của lần chạy bị crash trước đó |

---

## `imgfit exec`: job JSON từ chương trình khác

Dùng khi chương trình của bạn tự quyết định từng input → output (không dùng rule):

```bash
echo '{"schemaVersion":1,"jobs":[
  {"input":"a.jpg","output":"out/a.webp","size":[256,256],"mode":"cover","format":"webp"},
  {"input":"b.png","output":"out/b.png","preset":"thumb"}
]}' | imgfit exec --stdin
imgfit exec --file job.json --report-json report.json
```

- Job theo [schema/job.schema.json](schema/job.schema.json). Mỗi job có `input`, `output`, và **hoặc** `preset` (lấy từ `imgfit.json`, có thể kèm `"config"`) **hoặc** options inline (`size`, `mode`, `format`, `quality`, `position`, `focalPoint`, `background`, `smallInput`, `upscale`, `sharpen`, `stripMetadata`, `png`, `blockMultiple`).
- Cấp batch có thêm: `root` (mọi output phải nằm trong đây, mặc định là cwd), `onConflict`, `concurrency`, `dryRun`.
- stdout là **NDJSON**: mỗi dòng một JSON, gồm `{"type":"progress",…}`, `{"type":"result",…FileResult}` và cuối cùng `{"type":"summary",…}`. Đọc từng dòng để hiện tiến độ thời gian thực.
- Cùng các bảo đảm như `resize`: trùng đích thì dừng cả batch, không đè file có sẵn trừ khi `onConflict: "replace"`.

---

## Các lệnh khác

```bash
imgfit init [--profile generic|web|unity] [--force]   # config mẫu + schema + .gitignore; không ghi đè nếu không --force
imgfit info <file> [--json]                           # metadata: định dạng thật, kích thước sau EXIF, alpha, ICC
imgfit capabilities [--json]                          # định dạng mà bản build trên máy này hỗ trợ + version
imgfit schema config|result|info|job                  # JSON Schema để validate / sinh type
imgfit --version [--json]                             # thêm --json để có version sharp/libvips/node/platform
imgfit <lệnh> --help
```

---

## Output JSON, exit code, mã lỗi

### Report

`resize`, `run`, `check` và `exec` (dòng `summary` + các dòng `result`) dùng chung một cấu trúc:

```json
{
  "schemaVersion": 1,
  "tool": { "name": "imgfit", "version": "0.1.0", "sharp": "0.35.5", "libvips": "8.18.7" },
  "command": "run",
  "status": "ok",
  "dryRun": false,
  "startedAt": "2026-11-14T04:42:00.315Z",
  "elapsedMs": 212,
  "summary": {
    "total": 2, "processed": 1, "created": 1, "replaced": 0, "unchanged": 1, "adopted": 0, "planned": 0,
    "skipped": 0, "failed": 0, "cancelled": 0, "pass": 0, "warn": 0, "fail": 0,
    "inputBytes": 421888, "outputBytes": 10035, "bytesSaved": 411853
  },
  "files": [
    {
      "file": "images-src/photos/a.jpg",
      "destination": "public/images/thumb/a.webp",
      "status": "created",
      "action": "create",
      "rule": "photos",
      "preset": "thumb",
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
  "errors": [],
  "warnings": []
}
```

- **`status` của report:** `ok` | `failed` (có file lỗi hoặc `fail`) | `aborted` (dừng trước khi ghi) | `cancelled`.
- **`status` của file:** `planned` (dry-run; xem `action`: `create`/`replace`/`adopt`), `created`, `replaced`, `unchanged`, `adopted`, `skipped`, `failed`, `cancelled`; `pass`/`warn`/`fail` cho `check`.
- **Đường dẫn:** luôn dùng `/`. Với lệnh dự án, đường dẫn tương đối theo thư mục chứa `imgfit.json`; với `resize`/`exec`, tương đối theo cwd.
- **`inputPx`/`outputPx`** là `[rộng, cao]` sau EXIF. `outputBytes: null` nghĩa là chưa biết.
- **`fingerprint`** = SHA-256 của bytes nguồn + options hiệu lực (sau khi gộp defaults/profile, kể cả focal) + version pipeline/sharp/libvips.
- **Lỗi trước khi chạy** (sai tham số, config lỗi, không tìm thấy input): stdout là ErrorDocument `{ "schemaVersion": 1, "tool": {…}, "command": "run", "status": "error", "errors": [{ "code": "E_CONFIG_INVALID", "message": "…", "details": { "problems": [...] } }] }`.
- **Schema:** [schema/result.schema.json](schema/result.schema.json). Thay đổi phá vỡ cấu trúc chỉ xảy ra khi tăng `schemaVersion`. Test của imgfit validate report thật của mọi lệnh theo schema này.

> **Hãy xử lý theo `code`, đừng parse `message`.** Message là tiếng Việt, viết cho người đọc, và có thể đổi giữa các bản.

### Exit code

| Code | Ý nghĩa |
|---|---|
| `0` | Thành công (kể cả `unchanged`, bị skip có chủ đích, hoặc check chỉ có `warn` khi không `--strict`) |
| `1` | Có file lỗi hoặc `fail`, hoặc batch bị dừng vì trùng đích |
| `2` | Sai tham số, lệnh không tồn tại, config không có hoặc không hợp lệ, không tìm thấy input |
| `3` | Lỗi quyền truy cập hoặc môi trường, dự án đang bị khóa (`E_LOCKED`) |
| `130` | Bị hủy bằng Ctrl+C |

### Mã lỗi (`E_*`)

| Mã | Khi nào |
|---|---|
| `E_USAGE` | Tham số hoặc job sai |
| `E_CONFIG_NOT_FOUND` / `E_CONFIG_INVALID` | Không tìm thấy, hoặc `imgfit.json` (hay names/crops/managed) sai; `details.problems` liệt kê từng lỗi |
| `E_FORMAT_NOT_ALLOWED` | Định dạng output không nằm trong whitelist của profile |
| `E_INPUT_NOT_FOUND` | Input, glob hoặc `roots.input` không tồn tại |
| `E_INPUT_UNSUPPORTED` / `E_INPUT_CORRUPT` / `E_INPUT_ANIMATED` / `E_INPUT_TOO_LARGE` | Input không hỗ trợ / hỏng / ảnh động / vượt giới hạn pixel |
| `E_SMALL_INPUT` | Ảnh nhỏ hơn đích và `smallInput: error` |
| `E_FORMAT_UNSUPPORTED` | `format: keep` với TIFF/GIF |
| `E_EXTENSION_MISMATCH` | Đuôi trong template không khớp định dạng output |
| `E_NAME_MISSING` | Rule dùng `{id}` nhưng nguồn chưa có id |
| `E_OUTPUT_CONFLICT` | Đích có sẵn và chưa do imgfit quản lý (hoặc là thư mục) |
| `E_OUTPUT_MODIFIED` | Output đã bị sửa ngoài imgfit |
| `E_OUTPUT_COLLISION` / `E_OUTPUT_SAME_AS_SOURCE` | Trùng đích / đích trùng nguồn: cả batch dừng |
| `E_OUTPUT_INVALID` | Output encode xong nhưng sai: không publish |
| `E_OUTPUT_MISSING` / `E_OUTPUT_STALE` / `E_OUTPUT_NOT_REPRODUCIBLE` | `check`: thiếu output / cần chạy lại `run` / encode lại cho kết quả khác byte |
| `E_DIMENSIONS_MISMATCH` / `E_FORMAT_MISMATCH` / `E_BUDGET_EXCEEDED` | `check`: sai kích thước / sai định dạng hoặc đuôi / vượt ngân sách KB |
| `E_PATH_UNSAFE` | Đích nằm ngoài thư mục output (kể cả qua symlink) |
| `E_LOCKED` | Một `run` khác đang chạy trên dự án |
| `E_PERMISSION` / `E_DISK_FULL` / `E_WRITE_FAILED` | Lỗi hệ thống file |
| `E_FORBIDDEN` / `E_NOT_FOUND` / `E_STALE_CONFIRMATION` | Web UI: bị chặn / không tồn tại / xác nhận đã cũ |
| `E_CANCELLED` / `E_INTERNAL` | Bị hủy / lỗi không phân loại (hãy báo lại kèm `--verbose`) |

### Mã cảnh báo (`W_*`)

| Mã | Ý nghĩa |
|---|---|
| `W_ALPHA_FLATTENED`, `W_DEFAULT_BACKGROUND` | Alpha bị flatten khi xuất JPG / đã dùng nền trắng mặc định |
| `W_SMALL_INPUT_KEPT`, `W_SMALL_INPUT_PADDED` | Ảnh nhỏ: giữ kích thước nhỏ / đệm nền |
| `W_BLOCK_ROUNDED` | Kích thước bị làm tròn xuống theo `blockMultiple` |
| `W_SKIP_EXISTING_UNVERIFIED` | Bỏ qua vì đích có sẵn; output cũ không được kiểm tra |
| `W_METADATA_KEPT` | Đang giữ metadata (có thể có GPS) |
| `W_OUTPUT_UNMANAGED` | `check`: output có nhưng chưa nằm trong `imgfit.managed.json` |
| `W_OUTPUT_ORPHAN` | Output được quản lý nhưng không còn rule/nguồn nào sinh ra |
| `W_OUTPUT_MODIFIED` | Output bị sửa tay, đã được thay theo `--overwrite` |
| `W_DUPLICATE_SOURCE` | Nhiều nguồn trùng nội dung trong cùng rule |
| `W_VERSION_MISMATCH` | Version đang chạy khác `.imgfit-version` |
| `W_STALE_LOCK`, `W_STATE_REBUILT` | Đã thay lock cũ / đã dựng lại cache hỏng |

---

## Tích hợp từ ngôn ngữ khác

Hợp đồng chung cho mọi ngôn ngữ:

1. Gọi tiến trình con bằng **mảng tham số** (không qua shell).
2. Thêm `--json` (hoặc dùng `exec`, output NDJSON). **stdout chỉ chứa JSON**; log và progress đi ra stderr.
3. Kiểm tra exit code và `status`, xử lý theo `errors[].code`.
4. Tìm binary theo **`IMGFIT_BIN`** trước, rồi mới tới `imgfit` trên `PATH`.
5. Cần type thì sinh từ `imgfit schema result|job` (quicktype, datamodel-code-generator…).

Các ví dụ chạy được nằm trong [examples/](examples/).

### Node (API trực tiếp)

```js
import { run, check, resize, exec } from "imgfit";

const report = await run({ cwd: "path/to/project", dryRun: false, onEvent: (e) => console.error(e.type, e.file) });
if (report.status !== "ok") process.exitCode = 1;

const r = await resize({ inputs: ["raw"], output: "out", width: 256, height: 256, mode: "cover", format: "webp" });
```

API còn có `check()`, `init()`, `exec()`, `watch()`, `info()`, `capabilities()`, `loadConfig()`, `buildManifest()`, `planTransform()`, `ImgfitError`, `exitCodeFor()` và đầy đủ type TypeScript. Lỗi trước khi chạy được **throw** dưới dạng `ImgfitError` (có `.code`); lỗi của từng file nằm trong report.

### Python

```python
import json, os, shutil, subprocess

bin = os.environ.get("IMGFIT_BIN") or shutil.which("imgfit")
proc = subprocess.run([bin, "run", "--json"], capture_output=True, text=True, encoding="utf-8", cwd="path/to/project")
report = json.loads(proc.stdout)                      # vẫn là JSON khi exit != 0
if report["status"] == "error":
    raise SystemExit([e["code"] for e in report["errors"]])
failed = [f for f in report["files"] if f["status"] == "failed"]
```

Bản đầy đủ: [examples/python/resize.py](examples/python/resize.py).

### PHP / Laravel

```php
use Illuminate\Support\Facades\Process;   // Laravel 10+

$result = Process::path(base_path())->run([env('IMGFIT_BIN', 'imgfit'), 'run', '--json']);
$report = json_decode($result->output(), true, flags: JSON_THROW_ON_ERROR);
if ($result->failed()) {
    throw new RuntimeException('imgfit: ' . json_encode(array_column($report['errors'] ?? [], 'code')));
}
```

PHP thuần (không framework) dùng `proc_open` với mảng lệnh: [examples/php/resize.php](examples/php/resize.php).

### Shell, PowerShell, CI

```bash
imgfit run --json > imgfit-report.json
jq -r '.files[] | select(.status=="failed") | "\(.file): \(.errors[0].code)"' imgfit-report.json
```

Trong PowerShell, đặt template trong **nháy đơn**: `--name '{dir}/{name}.{ext}'`, vì PowerShell hiểu `{…}` là scriptblock. Xem [examples/shell/](examples/shell/), [examples/hooks/pre-commit](examples/hooks/pre-commit), [examples/ci/github-actions.yml](examples/ci/github-actions.yml).

### Unity (C#)

[examples/unity/ImgfitMenu.cs](examples/unity/ImgfitMenu.cs) thêm menu *Tools/imgfit* (Run / Dry run / Check). Script gọi CLI bằng `ProcessStartInfo.ArgumentList`, rồi `AssetDatabase.Refresh()`. Ảnh được thay tại chỗ, nên `.meta`/GUID giữ nguyên. Dùng profile `unity` để chặn định dạng Unity không import (webp/avif).

### Lưu ý trên Windows

Lệnh `imgfit` cài qua npm, và `imgfit.cmd` trong bản portable, đều là file `.cmd`:

- **Python** cần đường dẫn đầy đủ: `shutil.which("imgfit")` trả về `…\imgfit.CMD`.
- **PHP** `proc_open` cần gọi `imgfit.cmd`.
- Nếu tham số có ký tự đặc biệt của `cmd.exe` (`%`, `^`, `&`), hãy gọi thẳng `[node.exe, …/dist/bin.js, …]` để không đi qua `cmd.exe`.

---

## Hiệu năng

Số đo bằng `npm run bench` (3 lần mỗi case, lấy median):

- **Ảnh test:** tự sinh từ nhiễu Gaussian, nên khó nén hơn ảnh thật (gần với trường hợp xấu). Filesystem cache ấm.
- **Máy đo:** Intel Core 5 210H (12 luồng), 16 GB RAM, Windows 11, Node 24.16, sharp 0.35.5, libvips 8.18.7.
- **Peak RSS** của cả tiến trình benchmark: khoảng 410 MB.

| Workload | jobs=1 | jobs=2 | jobs=4 | jobs=8 |
|---|---|---|---|---|
| 200 JPG 2400×2400 (781 MB) → 256×256 cover JPG | 10.8 s | 5.9 s | **3.2 s** | 3.0 s |
| 10 PNG alpha 3000×3000 (359 MB) → fit 1024 PNG | 3.6 s | 2.0 s | **1.4 s** | 1.5 s |
| `run` lại 200 ảnh không đổi (0 encode, vẫn hash 781 MB nguồn) | — | — | **0.8 s** | — |
| `run` lại sau khi xóa `.imgfit/` cache (hash lại output, 0 encode) | — | — | **0.8 s** | — |

So sánh định dạng (200 JPG → 256×256 cover, jobs=4, quality mặc định):

| Định dạng | Thời gian | Tổng output |
|---|---|---|
| JPG q85 | 3.2 s | 1.0 MB |
| WebP q82 | 3.4 s | 0.3 MB |
| AVIF q50 | 4.5 s | 0.1 MB |

Nhận xét:
- `jobs=4` (mặc định) đã gần mức bão hòa, vì bản thân libvips cũng chạy đa luồng.
- Lần chạy đầu ngay sau khi sinh ảnh (đĩa còn bận ghi) chậm hơn đáng kể (khoảng 7 s cho workload JPG). Vì vậy hãy so sánh trên cache ấm, đo nhiều lần.
- Kết quả trên máy bạn sẽ khác. Hãy tự chạy:

```bash
npm run bench
node scripts/bench.mjs --count 50 --jobs 2,4 --formats jpg,webp,avif --json
```

Mặc định không bật mozjpeg, PNG palette, nén PNG mức 9 hay `sharp.concurrency(1)`; các tùy chọn này cần đo trade-off trước. `UV_THREADPOOL_SIZE` phải được đặt trong môi trường **trước khi** chạy Node.

**Tái lập giữa các OS:** cùng version sharp/libvips thì output tạo trên Windows và Linux giống nhau từng byte. Điều này đã được kiểm tra bằng `check --check-mode reproducible` trong container Linux trên output tạo ở Windows. Khác version thì không còn đảm bảo, và fingerprint đổi theo.

---

## Giới hạn

- Máy chạy imgfit cần Node.js ≥ 20.15, hoặc dùng bản portable / Docker. Dự án dùng imgfit có thể viết bằng bất kỳ ngôn ngữ nào.
- File thực thi đơn (Node SEA) trên Windows phải được code-sign mới chạy được khi bật Smart App Control.
- Không hỗ trợ: ảnh động, HEIC, SVG, PSD/RAW, PDF, tải ảnh từ URL, nhận diện khuôn mặt.
- Output **không giống từng byte** giữa các version sharp/libvips, hay với imgproxy/Thumbor. Chỉ kích thước và quy tắc được đảm bảo.
- `attention` là heuristic, có thể crop lệch mặt; dùng focal point cho ảnh quan trọng.
- `check --check-mode output-only` không chứng minh crop đúng hay nguồn chưa đổi.
- `run` không tự xóa output mồ côi; chỉ cảnh báo.
- ZIP của web UI không hỗ trợ ZIP64 (mỗi file và tổng nhỏ hơn 4 GiB).
- Web UI phục vụ một người dùng trên máy cục bộ; không phải dịch vụ xử lý ảnh cho nhiều người.

## FAQ

**Chạy lại có đè ảnh không?** Không. Output không đổi thì `unchanged`; file lạ thì `E_OUTPUT_CONFLICT`; file bị sửa tay thì `E_OUTPUT_MODIFIED`. Chỉ thay khi nguồn hoặc preset đổi, hoặc khi bạn dùng `--overwrite`.

**Xóa `.imgfit/` có sao không?** Không. Đó chỉ là cache, backup và lock. Trạng thái quan trọng nằm trong `imgfit.managed.json` (được commit).

**Clone repo sang máy khác, chạy `run` có encode lại hết không?** Không, nếu cùng version sharp/libvips và có ảnh nguồn: output khớp `imgfit.managed.json` sẽ là `unchanged`.

**Dự án đã có ảnh từ trước, `run` báo conflict hàng loạt?** Chạy `imgfit run --adopt` một lần.

**Sao ảnh nhỏ bị báo lỗi?** Với `cover`/`pad`, imgfit không phóng to và không "giả vờ" tạo ảnh đúng W×H. Chọn `smallInput: keep|pad` hoặc `upscale: true`.

**Ảnh điện thoại bị xoay ngang?** imgfit đã xoay theo EXIF trước khi resize; output không còn tag orientation.

**Có giữ GPS không?** Không, metadata bị bỏ mặc định.

**Thấy file `.xxx.imgfit-….tmp` còn sót?** Đó là file tạm của một lần chạy bị dừng đột ngột; an toàn để xóa.

**Web UI báo 401?** Mở đúng URL có `?t=…` in trong terminal. Token chỉ dùng một lần cho mỗi lần khởi động; trình duyệt khác thì cần khởi động lại `imgfit ui`.

---

## Phát triển

```bash
npm ci
npm run build          # core (tsc) + UI (vite) → dist/
npm test               # vitest: unit + integration + API server + contract (ảnh test tự sinh)
npm run typecheck      # tsc + vue-tsc
npm run dev:ui         # Vite dev server (proxy /api tới imgfit ui --port 8765)
npm run bench          # build + benchmark
npm run smoke          # npm pack → cài vào project trống → gọi CLI + Node API
npm run portable       # bản portable cho nền tảng hiện tại → release/
npm run docker         # docker build
```

Cấu trúc:

```text
src/
├── bin.ts                 # entry lệnh `imgfit` (SIGINT, stdin, xác nhận adopt)
├── cli.ts                 # commander → main(argv, io) test được in-process
├── index.ts               # Node API công khai
├── commands/              # resize, run (+adopt), check, init, exec, watch, info/capabilities
├── config/                # load (schema + ngữ nghĩa + env + profile), manifest (rules → jobs), validate (Ajv)
├── core/
│   ├── engine.ts          # prepare → preflight trùng đích → encode → xác minh → publish (dùng chung)
│   ├── process.ts         # probe, planTransform (thuần), transformToFile (sharp)
│   ├── geometry.ts        # toán resize/crop/focal
│   ├── output.ts          # file tạm, publish độc quyền, replace + backup, retry Windows
│   ├── state.ts           # managed / cache / names / crops, ghi JSON nguyên tử
│   ├── lock.ts, paths.ts, template.ts, inputs.ts, formats.ts, fingerprint.ts
│   ├── report.ts, report-html.ts, errors.ts, exit.ts
└── server/                # web UI backend: security, sessions, batches (SSE), zip, app (routes)
ui/                        # Vue 3 + Vite: QuickView, ProjectView, components/, composables/
schema/                    # JSON Schema công khai: config, result, info, job
examples/                  # node, python, php, shell, hooks, ci, unity
scripts/                   # bench, smoke-package, build-portable
test/{unit,integration}/
Dockerfile, .github/workflows/ci.yml
```

Quy ước khi đóng góp:

- Mã lỗi/cảnh báo, exit code, cấu trúc JSON, schema config/job và placeholder là **hợp đồng công khai**. Chỉ được thêm mới; muốn đổi nghĩa thì phải tăng `schemaVersion`. Test hợp đồng sẽ fail nếu report lệch schema.
- Mọi thay đổi pipeline làm khác bytes output phải tăng `PIPELINE_VERSION` trong [src/core/fingerprint.ts](src/core/fingerprint.ts).
- Test dùng ảnh tự sinh trong thư mục tạm. **Không commit ảnh có bản quyền.**
