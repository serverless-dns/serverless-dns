#!/bin/sh

burl="https://cfstore.rethinkdns.com/blocklists"
dir="bc"
codec="u6"
f="basicconfig.json"
cwd=`pwd`
# exec this script from npm or project root
out="./src/${codec}-${f}"
# timestamp: 1667519318.799 stackoverflow.com/a/69400542
# nowms =`date --utc +"%s.%3N"`
now=`date --utc +"%s"`

# date from timestamp: stackoverflow.com/a/16311821
day=`date -d @$now "+%d"`
# week; ceil: stackoverflow.com/a/12536521
wk=$(((day + 7 -1) / 7))
# year
yyyy=`date -d @$now "+%Y"`
# month
mm=`date -d @$now "+%m"`

# stackoverflow.com/a/1445507
max=4
# 0..4 (5 loops)
for i in `seq 0 $max`
do
    echo "pre.sh: $i try $yyyy/$mm-$wk at $now from $cwd"

    # TODO: check if the timestamp within the json file is more recent
    # file/symlink exists? stackoverflow.com/a/44679975
    if [ -f "${out}" ] || [ -L "${out}" ]; then
        echo "pre.sh: no op"
        exit 0
    else
        wget -q "${burl}/${yyyy}/${dir}/${mm}-${wk}/${codec}/${f}" -O "${out}"
        wcode=$?

        if [ $wcode -eq 0 ]; then
            echo "pre.sh: $i ok $wcode"
            exit 0
        else
            # wget creates blank files on errs
            rm ${out}
            echo "pre.sh: $i not ok $wcode"
        fi
    fi

    # see if the prev wk was latest
    wk=$((wk - 1))
    if [ $wk -eq 0 ]; then
        # only feb has 28 days (28/7 => 4), edge-case overcome by retries
        wk="5"
        # prev month
        mm=$((mm - 1))
    fi
    if [ $mm -eq 0 ]; then
        mm="12"
        # prev year
        yyyy=$((yyyy - 1))
    fi
done

exit 1
