. as $l
| (try fromjson catch null) as $e
| if   $e == null           then $l
  elif $e.type=="assistant" then
    ( $e.message.content[]?
      | if   .type=="text"     then .text
        elif .type=="tool_use" then "> " + .name + " " + ((.input // {}) | tojson)
        else empty end )
  elif $e.type=="result"    then
    "-- " + ($e.subtype // "done")
      + " | " + (($e.num_turns // 0)|tostring) + " turns"
      + " | $" + (($e.total_cost_usd // 0)|tostring)
  elif $e.type=="system"    then
    "- " + (($e.session_id // "?")[0:8]) + " (" + ($e.model // "?") + ")"
  else empty end
