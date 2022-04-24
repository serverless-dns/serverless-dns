##### 「それ」は鳥であり、飛行機であり、「それ」は...Pi-holeの様なセルフホスト型DNSリゾルバです。

serverless-dnsは、Pi-Hole風の[コンテンツブロック](https://github.com/serverless-dns/blocklists)、サーバーレス、スタブDNS-over-HTTPSおよびDNS-over-TLSのリゾルバーです。
[Cloudflare Workers](https://workers.cloudflare.com/)、[Deno Deploy](https://deno.com/deploy)、[Fly.io](https://fly.io/)ですぐに実行できます。これらのサービスの無料版は、1カ月あたり10～20台分のDNSトラフィックをカバーするだけなら十分です。

## RethinkDNSの対応リゾルバ

RethinkDNSは、これらのエンドポイントで`serverless-dns`を実稼働させています。

|プラットフォーム  | サーバーの設置場所 | 対応しているプロトコル | 派生元のドメイン | 利用 |
| ------------- | ---------- | ----------------- | ------------------------------------------------------------------------- | ---------- |
|  CloudFlare  | 200+ ([公式](https://www.cloudflare.com/ja-jp/network/))       | DoH             | `basic.rethinkdns.com` | [Cloudflareで利用する](https://rethinkdns.com/configure?p=doh) |
| Deno Deploy | 30+ ([公式](https://deno.com/deploy/docs/regions))  | DoH | 非公開のβ版です。 |   |
| Fly.io         | 30+ ([公式](https://fly.io/docs/reference/regions/)) | DoHとDoT | `max.rethinkdns.com` | [Fly.ioで利用する](https://rethinkdns.com/configure?p=dot) |

サーバー側の処理時間は0ミリ秒から2ミリ秒（中央値）、エンドツーエンドの待ち時間は10ミリ秒から30ミリ秒（中央値）です。<br>
*地域やネット環境によって異なります。

## セルフホスト

Cloudflare Workersは、`serverless-dns`をセットアップするための最も簡単なプラットフォームです。<br>

[![Deploy to Cloudflare Workers](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/Neuron-Grid/serverless_dns_jp_version/)

段階的な説明は、以下を参照してください。

|プラットフォーム  | 難易度 | ランタイム |ドック|
| ------------- | ------ | ------ | --- |
|⛅ CloudFlare |	簡単 | [v8](https://v8.dev/) Isolates       | 	[Cloudflare Workersにホスティング](https://docs.rethinkdns.com/dns/open-source/#cloudflare)|
|🦕 Deno.com   | 中程度 | [Deno](https://deno.land/)	Isolates  |     [Deno.comにホスティング](https://docs.rethinkdns.com/dns/open-source/#deno-deploy)|
|🪂 Fly.io     | 難しい | [Node](https://nodejs.org/en/) MicroVM |     [Fly.ioにホスティング](https://docs.rethinkdns.com/dns/open-source/#fly-io)|

ブロックリストの設定は、ブラウザから`https://<my-domain>.tld/configure`にアクセスしてください。<br>
ヘルプやサポートが必要な場合は、お気軽に[課題を作成](https://github.com/celzero/docs/issues)したり、[パッチを送信](https://github.com/celzero/docs)してください。

----
## 開発者の皆様へ

#### セットアップ

コード:

```
# work directoryに移動する
cd /my/work/dir

# このリポジトリをクローンする
git clone https://github.com/Neuron-Grid/Rethink_DNS_JP_version.git

# serverless-dnsに移動する
cd ./Rethink_DNS_JP_version
```

ノード:
```
# 必要であれば、nvm経由でnode v16+をインストールしてください。
# https://github.com/nvm-sh/nvm#installing-and-updating
wget -qO- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.1/install.sh | bash
nvm install --lts

# jsの依存関係を取得する
npm i

# 依存関係を更新する (これは任意です)
npm update

# ノード上でserverless-dnsを実行する
./run n

# clinicjs.orgのプロファイラーを実行する
./run n [upu|fn|mem]
```

Deno:
```
# deno.land v1.18+をインストールします。(これは任意です）
# https://github.com/denoland/deno/#install
curl -fsSL https://deno.land/install.sh | sh

# denoでserverless-dnsを実行する。
./run d
```
Wrangler:
```
# Cloudflare Workers (cli)、別名Wranglerをインストールします。
# https://developers.cloudflare.com/workers/cli-wrangler/install-update
npm i @cloudflare/wrangler -g

# Cloudflare Workers(cli)上でserverless-dnsを実行する。
# Wranglerを先にセットアップしてください。
# https://developers.cloudflare.com/workers/cli-wrangler/authentication
./run w

# Chrome DevToolsを使用したprofile wrangler
# blog.cloudflare.com/profiling-your-workers-with-wrangler
```
#### コード体系

このリポジトリへのコミットは、Google JavaScriptスタイルガイド(ref: [.eslintrc.cjs](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/.eslintrc.cjs))に準拠しています。`.js`ファイルに対してlinter (eslint)とformatter (prettier)を実行するgit`pre-commit`フックです。このフックを回避するには、`git commit --no-verify`を使用してください。<br>

また、Pull requestはコードスタイルに違反がないかチェックされ、可能な限り自動的に修正されます。

#### 環境変数
デフォルトを微調整する必要がある場合は、`.env`([ref](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/.env.example))または[`env.js`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/core/env.js)を設定してください。`.env`ファイルの値は、`env.js`で設定された対応する変数より優先されます。Cloudflare Workers の場合は、[`wrangler.toml`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/wrangler.toml)でenv変数を設定します。<br>

#### リクエストのフロー
1 リクエスト/レスポンスのフローは以下のようになります。<br>
クライアント ⇆ `src/server-[node|workers|deno]` ⇆ [`doh.js`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/core/doh.js) ⇆ [`plugin.js`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/core/plugin.js) <br>
2 plugin.jsのフローは以下のようになります。<br>
`userOperation.js`　→　`cacheResponse.js` → `cc.js` → `dnsResolver.js`<br>

--------------

#### ランタイムに関する注意点
Deno Deploy（クラウド）とDeno（ランタイム）は同じAPI surfaceを公開していません。（例えば、Deno DeployはHTTP/S server-listenersのみをサポートし、Denoはplain HTTPとHTTP/Sに加え、raw TCP/UDP/TLSをサポートしています。)

Node 以外では、`serverless-dns`はenv varsの`CF_DNS_RESOLVER_URL` / `CF_DNS_RESOLVER_URL_2`で定義されたDoHアップストリームを使用します。
Nodeでは、デフォルトのDNSアップストリームは1.1.1.2([ref](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/15f628460/src/commons/dnsutil.js#L28))です。

NodeとDenoのエントリポイントはそれぞれ[`src/server-node.js`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/server-node.js)、[`src/server-deno.ts`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/server-deno.ts)で、どちらもTCP-over-TLS、HTTP/S接続を待ちます。一方で、HTTP（cli）またはHTTP/S（prod）のみで待ち受けるCloudflare Workersのエントリポイントは、[`src/server-workers.js`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/server-workers.js)となります。

DenoのprodセットアップとNodeのlocal(non-prod)セットアップでは、デフォルトで鍵(private)とcert(public chain)のファイルはenv varsの`TLS_KEY_PATH`と`TLS_CRT_PATH`で定義したパスから読み込まれるようになっています。<br>

Nodeでprodの設定を行う場合は、`TLS_CERTKEY`([ref](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/15f62846/src/core/node/config.js#L61-L82))を介して、鍵や証明書をbase64エンコードしてenv varに格納する必要があるため、以下のようになります。<br>
```
#鍵（秘密鍵）と証明書（公開鍵）の両方のbase64表現してください。
TLS_CERTKEY="KEY=b64_key_content\nCRT=b64_cert_content"
```

プロセスの起動は、それぞれのランタイムで異なります。<br>
Nodeでは[`src/core/node/config.js`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/core/node/config.js)です。<br>
Denoでは[`src/core/deno/config.ts`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/core/deno/config.ts)です。<br>
Workersでは[`src/core/workers/config.js`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/src/core/workers/config.js)がそれぞれ起動にあたります。<br>

NodeとDenoでは[`@serverless-dns/lfu-cache`](https://github.com/serverless-dns/lfu-cache)でバックアップされたプロセス内DNSキャッシュが使用されます。
Cloudflare Workersでは[Cache Web API](https://developers.cloudflare.com/workers/runtime-apis/cache/)とプロセス内キャッシュの両方が使用されます。3つのプラットフォームでキャッシュを完全に無効にするには、環境変数に`PROFILE_DNS_RESOLVES=true`を設定してください。<br>

#### Cloud

Cloudflare WorkersとDeno Deployは、クライアントのリクエストを処理するプロセスは動的です。実際に、2つの異なる[隔離プロセス](https://developers.cloudflare.com/workers/learning/how-workers-works/)により、2つの背中合わせのリクエストが処理される場合があります。Fly.ioのResolverはNodeで動作しており、[永続的なVM](https://fly.io/blog/docker-without-docker/)にバックアップされているため、従来の「サーバフル」な環境と同様に長寿命です。


Cloudflare Workersの構築時および実行時の設定は[`wrangler.toml`](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/wrangler.toml)で定義されています。Webpack5がESMモジュールに[ファイルをバンドル](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/webpack.config.cjs)し、WranglerがCloudflareにアップロードします。

Deno Deployの、コードベースはdeno bundleで1つのjavascriptファイルにまとめられ、Deno.comに渡されます。

Nodeが動作するFly.ioの場合は、ランタイムディレクティブは[fly.toml](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/fly.toml)に、デプロイディレクティブは[node.Dockerfile](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/main/node.Dockerfile)に定義されています。それに合わせて[flyctl](https://fly.io/docs/flyctl/)はFly.ioのインフラ上に`serverless-dns`をセットアップしています。

参考 : [github/workflows](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/tree/main/.github/workflows)

#### Blocklist

190以上のブロックリストをSteve Hanovのimplベース([Succinct Radix Trie](https://stevehanov.ca/blog/?id=120))の技術に圧縮され、「succintness」を犠牲にして文字列検索(lookup)を高速化するように修正されています。Blocklistはnixタイムスタンプで管理され(env var: `CF_LATEST_BLOCKLIST_TIMESTAMP`)週に１回生成されますが、可能であれば毎日/毎時生成したいです。Lightsail Object Storeでホストされます 。(env var: `CF_BLOCKLIST_URL`)
`serverless-dns`は、実行時の起動時やDNSリクエストの処理時にradix trieを設定するために必要な[3つのブロックリストファイル](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/15f62846/src/core/node/blocklists.js#L14-L16)をダウンロードします。<br>
参考 : [src/plugins/dns-operation/dnsResolver.js](https://github.com/Neuron-Grid/Rethink_DNS_JP_version/blob/15f62846/src/plugins/dns-operation/dnsResolver.js#L167)

`serverless-dns`は、約190以上のブロックリストから、約500万エントリ（2022年2月現在）を簡潔な基数木にコンパイルします。これらは[serverless-dns/blocklists](https://github.com/serverless-dns/blocklists)リポジトリで定義されています。

Blocklistに関しても日本語版があります。
もし興味があれば[ご覧ください](https://github.com/Neuron-Grid/BlockLists_for_JP)。
