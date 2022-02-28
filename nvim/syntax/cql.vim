if exists("b:current_syntax")
  finish
endif

let b:current_syntax = "cql"



" Reserved words
syn keyword cqlKeywordDeclarations define function library using include version called parameter default valueset code codesystems display public private context
syn keyword cqlKeywordConst Patient Population null
syn keyword cqlKeywordBool true false
syn match cqlTimingUnits "\vyears?|months?|days?|hours?|minutes?|seconds?|milliseconds?"
syn match cqlTimingQual "\vstarts?|ends?"
syn match cqlSortBy "\vasc(ending)?|desc(ending)?"
syn keyword cqlNumeric properly within
syn keyword cqlTemporal or before after as occurs meets overlaps includes during included in less more from between difference contains
syn keyword cqlLogic and or xor not Coalesce is
syn keyword cqlTypeCast cast as convert to is ToBoolean ToConcept ToDateTime ToDecimal ToInteger ToQuantity ToString ToTime
syn keyword cqlArithmetic Abs Ceiling div Floor Log Ln maximum minimum mod predecessor Round successor Truncate
syn keyword cqlStringOp Combine Length Lower PositionOf Split Substring Upper
syn keyword cqlDateOp DateTime Now TimeOfDay Today
syn keyword cqlDateTimeOp Calculate Age In Years Months Days Hours Minutes Seconds At
syn keyword cqlIntervalOp collapse width
syn keyword cqlListOp all distinct exists expand First IndexOf Last Length singleton except in intersect union
syn keyword cqlAggregateOp AllTrue AnyTrue Avg Count Max Min Median Mode PopulationStdDev PopulationVariance StdDev Sum Variance
syn keyword cqlControl if then else case when end
syn keyword cqlQueryControl from with without where return such that sort by
syn keyword cqlType Any Boolean Code Concept DateTime Decimal Integer Interval List Quantity String Time Tuple

hi link cqlTimingUnits keyword
hi link cqlTimingQual keyword
hi link cqlSortBy keyword
hi link cqlNumeric keyword
hi link cqlTemporal keyword
hi link cqlLogic keyword
hi link cqlTypeCast keyword
hi link cqlArithmetic keyword
hi link cqlStringOp Operator
hi link cqlDateOp Operator
hi link cqlDateTimeOp Operator
hi link cqlIntervalOp Operator 
hi link cqlListOp Operator
hi link cqlAggregateOp Operator
hi link cqlControl keyword
hi link cqlQueryControl keyword
hi link cqlType Type
hi link cqlKeywordDeclarations keyword
hi link cqlKeywordConst Constant
hi link cqlKeywordBool Boolean 

" Function name
syn match func "\v\w+\(.*\)\:"
hi link func Function 

" Comments
syn match cqlComment "\v//.*$"
syn region cqlCommentMulti start="\v/\*" end="\v\*/"

hi link cqlCommentMulti Comment
hi link cqlComment Comment

" Strings
syn region cqlString start=/\v'/ skip=/\v\\./ end=/\v'/

hi link cqlString String

syn region cqlDoubleQuote start=/\v"/ skip=/\v\\./ end=/\v"/
hi link cqlDoubleQuote Function
