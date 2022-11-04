#!/bin/sh

burl="https://cfstore.rethinkdns.com/blocklists"
dir="bc"
codec="u6"
f="basicconfig.json"
# exec this script from npm or project root
out="./src/${f}"

# timestamp: 1667519318.799 stackoverflow.com/a/69400542
# nowms =`date --utc +"%s.%3N"`
now=`date --utc +"%s"`

# date from timestamp: stackoverflow.com/a/16311821
day=`date -d @$now "+%d"`
# week; ceil: stackoverflow.com/a/12536521
wk=`echo "(($day + 7 - 1) / 7)" | bc`
# year
yyyy=`date -d @$now "+%Y"`
# month
mm=`date -d @$now "+%m"`

# file/symlink exists? stackoverflow.com/a/44679975
if [ -f "${out}" ] || [ -L "${out}" ]; then
    echo "pre.sh: no op"
else
    echo "$yyyy $mm $wk $day $now"

    wget -q "${burl}/${yyyy}/${dir}/${mm}-${wk}/${codec}/${f}" -O "${out}"

    # always exit 0
    echo "pre.sh ok? $?"
fi
