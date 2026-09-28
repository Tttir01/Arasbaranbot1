name: Arasbaran News Bot

on:
  schedule:
    # هر ۱۵ دقیقه یک‌بار اجرا می‌شود (زمان‌بندی GitHub Actions بر اساس UTC است)
    - cron: '*/15 * * * *'
  workflow_dispatch: {}   # امکان اجرای دستی از تب Actions در گیت‌هاب

permissions:
  contents: write   # برای کامیت‌کردن به‌روزرسانی data/sent-links.json

jobs:
  run-bot:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Setup Node.js
        uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install dependencies
        run: npm install --omit=dev

      - name: Run news bot
        env:
          TELEGRAM_BOT_TOKEN: ${{ secrets.TELEGRAM_BOT_TOKEN }}
          TELEGRAM_CHAT_ID: ${{ secrets.TELEGRAM_CHAT_ID }}
        run: npm start

      - name: Commit updated sent-links history
        run: |
          git config user.name "arasbaran-news-bot"
          git config user.email "actions@users.noreply.github.com"
          git add data/sent-links.json
          git diff --cached --quiet || git commit -m "chore: update sent news history [skip ci]"
          git push
