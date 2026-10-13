// 此文件由 scripts/gen-defaults.mjs 从 defaults.json 生成，请勿手工修改。
const defaults = {
  "notes": {
    "shopRules": "积分累计不清零；每周日统一兑换，也可以继续攒分不兑换；80积分每周只可兑换一次。",
    "monthlyNote": "表格原备注：每月兑换一次奖罚卡，兑换后如有零头可累积到下次。"
  },
  "categories": [
    {
      "id": "cat-life",
      "name": "生活习惯",
      "color": "#10b981",
      "deletedAt": null
    },
    {
      "id": "cat-study",
      "name": "学习习惯",
      "color": "#3b82f6",
      "deletedAt": null
    },
    {
      "id": "cat-bonus",
      "name": "加分项",
      "color": "#f59e0b",
      "deletedAt": null
    },
    {
      "id": "cat-penalty",
      "name": "扣分项",
      "color": "#ef4444",
      "deletedAt": null
    }
  ],
  "rules": [
    {
      "id": "rule-life-01",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "7:20按时起床",
          "categoryId": "cat-life",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-life-02",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "22:00前上床睡觉",
          "categoryId": "cat-life",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-life-03",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "少吃零食，多吃饭、不浪费",
          "categoryId": "cat-life",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-life-04",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "每天跳绳200个",
          "categoryId": "cat-life",
          "points": 3
        }
      ]
    },
    {
      "id": "rule-life-05",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "每天跳绳300个",
          "categoryId": "cat-life",
          "points": 5
        }
      ]
    },
    {
      "id": "rule-life-06",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "房间个人物品摆放好，书桌摆放整齐",
          "categoryId": "cat-life",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-life-07",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "自己的事情自己做",
          "categoryId": "cat-life",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-life-08",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "有礼貌、不乱发脾气，不撒谎",
          "categoryId": "cat-life",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-life-09",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "做事不拖拉，听到指令立马行动",
          "categoryId": "cat-life",
          "points": 5
        }
      ]
    },
    {
      "id": "rule-study-01",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "早上坚持英语磨耳朵",
          "categoryId": "cat-study",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-study-02",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "每日完成英格艾嘉发布任务",
          "categoryId": "cat-study",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-study-03",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "书桌摆放整齐，写作业时没有与学习无关的用品",
          "categoryId": "cat-study",
          "points": 3
        }
      ]
    },
    {
      "id": "rule-study-04",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "写作业认真，不打野，独立思考",
          "categoryId": "cat-study",
          "points": 10
        }
      ]
    },
    {
      "id": "rule-study-05",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "作业途中不下位，不上厕所，不喝水，不讲话",
          "categoryId": "cat-study",
          "points": 5
        }
      ]
    },
    {
      "id": "rule-study-06",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "端正坐姿、字迹工整",
          "categoryId": "cat-study",
          "points": 10
        }
      ]
    },
    {
      "id": "rule-study-07",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "坚持每日背，默单词，朗读课文",
          "categoryId": "cat-study",
          "points": 5
        }
      ]
    },
    {
      "id": "rule-study-08",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "学习后整理自己书桌、书包",
          "categoryId": "cat-study",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-study-09",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "坚持课外阅读20分钟",
          "categoryId": "cat-study",
          "points": 2
        }
      ]
    },
    {
      "id": "rule-study-10",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "坚持每日口算",
          "categoryId": "cat-study",
          "points": 5
        }
      ]
    },
    {
      "id": "rule-bonus-01",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "考试有进步",
          "categoryId": "cat-bonus",
          "points": 10
        }
      ]
    },
    {
      "id": "rule-bonus-02",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "期末考试数学，英语95分以上（单科50分）",
          "categoryId": "cat-bonus",
          "points": 100
        }
      ]
    },
    {
      "id": "rule-bonus-03",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "听写、计算全对",
          "categoryId": "cat-bonus",
          "points": 10
        }
      ]
    },
    {
      "id": "rule-penalty-01",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "上学迟到；被老师点名批评（包括英格爱嘉，篮球课）",
          "categoryId": "cat-penalty",
          "points": -10
        }
      ]
    },
    {
      "id": "rule-penalty-02",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "作业未完成",
          "categoryId": "cat-penalty",
          "points": -10
        }
      ]
    },
    {
      "id": "rule-penalty-03",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "说谎、打人、说脏话、沉迷游戏",
          "categoryId": "cat-penalty",
          "points": -10
        }
      ]
    },
    {
      "id": "rule-penalty-04",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "乱发脾气、不讲道理",
          "categoryId": "cat-penalty",
          "points": -10
        }
      ]
    },
    {
      "id": "rule-penalty-05",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "不听大人话、惹大人生气",
          "categoryId": "cat-penalty",
          "points": -10
        }
      ]
    },
    {
      "id": "rule-penalty-06",
      "deletedAt": null,
      "versions": [
        {
          "effectiveDate": null,
          "name": "周一到周四看电视/平板",
          "categoryId": "cat-penalty",
          "points": -10
        }
      ]
    }
  ],
  "rewards": [
    {
      "id": "reward-80",
      "deletedAt": null,
      "versions": [
        {
          "id": "reward-80-v1",
          "effectiveDate": null,
          "cost": 80,
          "text": "1. 自选小零食1份\n2. 自选小文具1份\n3. 看10分钟英语动画片",
          "ruleNote": "每周限换1次"
        }
      ]
    },
    {
      "id": "reward-200",
      "deletedAt": null,
      "versions": [
        {
          "id": "reward-200-v1",
          "effectiveDate": null,
          "cost": 200,
          "text": "1. 晚睡10分钟\n2. 自选零食3份\n3. 免口算一天",
          "ruleNote": ""
        }
      ]
    },
    {
      "id": "reward-400",
      "deletedAt": null,
      "versions": [
        {
          "id": "reward-400-v1",
          "effectiveDate": null,
          "cost": 400,
          "text": "自选玩具一件（20元以内）",
          "ruleNote": ""
        }
      ]
    },
    {
      "id": "reward-600",
      "deletedAt": null,
      "versions": [
        {
          "id": "reward-600-v1",
          "effectiveDate": null,
          "cost": 600,
          "text": "1. 自选玩具一件（50元以内）\n2. 自选小吃（50元以内）\n3. Switch 1小时",
          "ruleNote": ""
        }
      ]
    },
    {
      "id": "reward-800",
      "deletedAt": null,
      "versions": [
        {
          "id": "reward-800-v1",
          "effectiveDate": null,
          "cost": 800,
          "text": "1. 周末自由安排活动4小时\n2. Switch 1.5小时",
          "ruleNote": ""
        }
      ]
    },
    {
      "id": "reward-1000",
      "deletedAt": null,
      "versions": [
        {
          "id": "reward-1000-v1",
          "effectiveDate": null,
          "cost": 1000,
          "text": "自选一份大餐（自己选餐厅）",
          "ruleNote": ""
        }
      ]
    }
  ]
};

export default defaults;
