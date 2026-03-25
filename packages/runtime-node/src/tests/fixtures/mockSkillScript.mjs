/**
 * 本文件作用：
 * - 提供给 catalog bridge 测试使用的最小 skill 脚本。
 * - 同时支持 `--args-json` 与 flags 两种输入方式，便于验证 bridge 的归一化逻辑。
 */

function parsePrimitive(rawValue) {
  if (rawValue === "true") return true;
  if (rawValue === "false") return false;
  if (rawValue === "null") return null;
  if (/^-?\d+(\.\d+)?$/.test(rawValue)) return Number(rawValue);
  return rawValue;
}

function parseFlags(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) continue;
    const key = token.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      result[key] = true;
      continue;
    }
    result[key] = parsePrimitive(next);
    index += 1;
  }
  return result;
}

const argv = process.argv.slice(2);
const argsJsonIndex = argv.indexOf("--args-json");
let args;
if (argsJsonIndex >= 0 && argv[argsJsonIndex + 1]) {
  args = JSON.parse(argv[argsJsonIndex + 1]);
} else if (process.env.SIMPAGENT_SKILL_ARGS_JSON) {
  args = JSON.parse(process.env.SIMPAGENT_SKILL_ARGS_JSON);
} else {
  args = parseFlags(argv);
}

if (args.fail === true) {
  console.error("mock skill requested failure");
  process.exit(3);
}

console.log(
  JSON.stringify({
    ok: true,
    transport: "skill-script",
    args,
    echoed: `${String(args.message ?? "")}:${String(args.count ?? "")}`
  })
);

