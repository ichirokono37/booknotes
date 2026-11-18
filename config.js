// 読書の種 - 設定ファイル
// Azure（Microsoft Entra）でアプリ登録したあと、clientId に「アプリケーション（クライアント）ID」を貼り付けてください。
// 空のままでも、端末内だけで保存するモードで動きます。
window.BOOKNOTES_CONFIG = {
  clientId: "",

  // 個人用 Microsoft アカウント向け（変更不要）
  authority: "https://login.microsoftonline.com/consumers",

  // OneDrive 上の保存先（OneDrive のルートからのパス）
  // PC の C:\Users\User\OneDrive\AI drive personal\書籍学習\booknotes\data に対応します
  dataPath: "AI drive personal/書籍学習/booknotes/data",
};
