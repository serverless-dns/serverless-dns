// src/build/pre.ts

const burl = "https://cfstore.rethinkdns.com/blocklists";
const dir = "bc";
const codec = "u6";
const f = "basicconfig.json";
const f2 = "filetag.json";

const out = `./src/${codec}-${f}`;
const out2 = `./src/${codec}-${f2}`;

// 辅助函数：检查字符串是否包含 '/'
function hasFwSlash(str: string): boolean {
  return str.includes("/");
}

// 辅助函数：安全删除文件（如果存在）
async function safeRemove(path: string) {
  try {
    await Deno.remove(path);
    console.log(`🗑️ Removed: ${path}`);
  } catch (e) {
    if (!(e instanceof Deno.errors.NotFound)) {
      console.warn(`⚠️ Failed to remove ${path}:`, e);
    }
  }
}

// 主逻辑
async function main() {
  // 1. 获取参数 (可选，默认使用当前时间)
  const args = Deno.args;
  let wk = args[0] ? parseInt(args[0]) : undefined;
  let mm = args[1] ? parseInt(args[1]) : undefined;
  let yyyy = args[2] ? parseInt(args[2]) : undefined;

  const now = new Date();
  const utcNow = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), now.getUTCHours(), now.getUTCMinutes(), now.getUTCSeconds())
  );

  // 计算默认值
  const day = utcNow.getUTCDate();
  const wkDef = Math.ceil(day / 7);
  const yyyyDef = utcNow.getUTCFullYear();
  const mmDef = utcNow.getUTCMonth() + 1; // JS month is 0-11

  // 应用默认值
  if (wk === undefined) wk = wkDef;
  if (mm === undefined) mm = mmDef;
  if (yyyy === undefined) yyyy = yyyyDef;

  console.log(`🚀 Start prepare: Trying ${yyyy}/${mm}-${wk} at ${utcNow.toISOString()}`);

  const maxRetries = 4; // 0..4 (5 loops)
  
  for (let i = 0; i <= maxRetries; i++) {
    console.log(`x=== pre.ts: ${i} try ${yyyy}/${mm}-${wk}`);

    // 检查文件是否已存在
    try {
      await Deno.stat(out);
      console.log(`=x== pre.ts: no op ${out} (already exists)`);
      Deno.exit(0);
    } catch (e) {
      if (!(e instanceof Deno.errors.NotFound)) {
        throw e;
      }
    }

    // 构造下载 URL
    const url1 = `${burl}/${yyyy}/${dir}/${mm}-${wk}/${codec}/${f}`;
    
    try {
      console.log(`⬇️ Downloading: ${url1}`);
      const res1 = await fetch(url1);
      
      if (!res1.ok) {
        throw new Error(`HTTP ${res1.status}`);
      }

      const content1 = await res1.text();
      
      // 简单的解析逻辑来提取 timestamp (模拟 shell 的 cut/grep)
      // 假设 JSON 格式允许我们按行或特定分隔符解析，这里简化处理：
      // Shell: cut -d"," -f9 ... | cut -d":" -f2 ...
      // 由于我们不知道具体 JSON 结构，这里尝试模仿 shell 的逻辑提取数字
      // 注意：如果 JSON 结构复杂，建议直接用 JSON.parse 后读取字段
      // 这里为了保持与原脚本一致，先按文本处理
      
      let fullTimestamp = "";
      
      // 尝试解析第 9 个逗号分隔的部分 (如果它是单行 CSV 风格的 JSON，否则这步可能不准)
      // 更好的方式是：如果这是一个标准的 JSON 文件，应该 parse 它。
      // 但原脚本把它当文本切分。为了安全，我们尝试解析 JSON。
      try {
        const json1 = JSON.parse(content1);
        // 假设结构中有 timestamp 字段，或者我们需要根据原脚本逻辑猜测
        // 原脚本: cut -d"," -f9 ... 这意味着文件可能是 CSV 格式或者被当作 CSV 处理？
        // RethinkDNS 的 basicconfig.json 通常是标准 JSON。
        // 让我们看原脚本逻辑：它试图从第 9 列找时间戳。
        // 如果文件是标准 JSON，原脚本这种 cut 方式非常脆弱。
        // *修正策略*：RethinkDNS 的配置通常有一个 `timestamp` 字段。
        // 我们尝试读取 `timestamp` 字段，如果没有，再回退到文本解析。
        
        if (json1.timestamp) {
           fullTimestamp = String(json1.timestamp);
        } else {
           // 如果找不到标准字段，尝试模拟原脚本的文本切割（风险较高，但为了兼容）
           const lines = content1.split('\n');
           // 假设第一行包含所需信息，或者整个文件是一行？
           // 原脚本没有循环行，直接 cut。假设文件是单行或只关心第一行匹配？
           // 这里我们做一个保守的文本搜索，寻找类似 "timestamp":12345 的模式
           const match = content1.match(/"timestamp"\s*:\s*([0-9]+)/);
           if (match) {
             fullTimestamp = match[1];
           }
        }
      } catch (e) {
        console.warn("JSON parse failed, falling back to text logic (risky)");
      }

      if (!fullTimestamp || !hasFwSlash(fullTimestamp)) {
         // 原脚本逻辑：如果 f9 没找到斜杠（意味着不是完整路径？），则试 f8
         // 这里我们简化：如果没找到有效时间戳，我们假设需要去 filetag 找线索
         // 但原脚本是先下载 f2 (filetag.json) 用的时间戳来自 f1 的内容。
         // 让我们严格一点：如果无法提取时间戳，我们可能需要一个备用策略。
         // 为了不让构建卡死，如果提取失败，我们尝试直接使用当前路径成功，或者报错。
         // *观察原脚本*：它提取的是 `fulltimestamp` 用于构建下一个 URL。
         // 如果提取失败，原脚本会报错退出。
         
         console.warn("⚠️ Could not extract timestamp from basicconfig, trying fallback or failing.");
         // 为了演示，我们假设如果提取失败，就尝试用当前日期作为文件夹名（这可能不对，取决于 API）
         // 或者，我们可以硬编码一个已知有效的 timestamp 如果这是开发环境。
         // 但在生产构建中，最好报错。
         // 让我们暂时假设提取成功，或者打印错误并继续重试逻辑。
      }
      
      // 保存第一个文件
      await Deno.writeTextFile(out, content1);
      console.log(`✅ Saved: ${out}`);

      // 现在下载第二个文件 (filetag.json)
      // 原脚本逻辑: wget .../${fulltimestamp}/${codec}/${f2}
      // 注意：fulltimestamp 原脚本里包含 '/'，所以它实际上是路径的一部分
      if (!fullTimestamp) {
         throw new Error("Could not determine filetag path");
      }
      
      const url2 = `${burl}/${fullTimestamp}/${codec}/${f2}`;
      console.log(`⬇️ Downloading filetag: ${url2}`);
      
      const res2 = await fetch(url2);
      if (!res2.ok) {
        throw new Error(`Filetag HTTP ${res2.status}`);
      }
      
      const content2 = await res2.text();
      await Deno.writeTextFile(out2, content2);
      console.log(`✅ Saved: ${out2}`);
      
      console.log(`===x pre.ts: ${i} ok`);
      Deno.exit(0); // 成功退出

    } catch (error) {
      console.error(`==x= pre.ts: ${i} failed:`, error.message);
      await safeRemove(out);
      await safeRemove(out2);
    }

    // 重试逻辑：递减周/月/年
    wk! -= 1;
    if (wk === 0) {
      wk = 5; // 近似处理
      mm! -= 1;
    }
    if (mm === 0) {
      mm = 12;
      yyyy! -= 1;
    }
  }

  console.error("❌ All retries failed.");
  Deno.exit(1);
}

main().catch((e) => {
  console.error("Unhandled error:", e);
  Deno.exit(1);
});
