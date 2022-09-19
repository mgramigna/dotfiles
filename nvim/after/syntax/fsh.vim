if exists("b:current_syntax")
  finish
endif

let b:current_syntax = "fsh"

" Reserved words
syn keyword fshKeywordDef Alias Profile Extension Instance InstanceOf Invariant ValueSet CodeSystem RuleSet Mapping Logical Resource Parent Id Title Description Expression XPath Severity Usage Source Target
syn keyword fshKeywordDefTrial Logical Resource
syn keyword fshKeywordOther MS SU TU N D from named and only or obeys include exclude codes where valueset system insert contains
syn keyword fshKeywordParens example preferred extensible required exactly contained
syn keyword fshKeywordBool true false 
syn region testMatt start="(" end=")" contains=fshKeywordParens transparent

hi link fshKeywordDef keyword
hi link fshKeywordDefTrial keyword
hi link fshKeywordOther keyword
hi link fshKeywordParens keyword
hi link fshKeywordBool Boolean 

" Comments
syn match fshComment "\v//.*$"
syn region fshCommentMulti start="\v/\*" end="\v\*/"

hi link fshCommentMulti Comment
hi link fshComment Comment

" Deconflict urls with comments and reserved words
syn region fshUrl start=/\vhttps?/ end=/\v($|\s)/
hi link fshUrl Identifier

" Strings
syn region fshString start=/\v"/ skip=/\v\\./ end=/\v"/
syn region fshStringTriple start=/\v"""/ skip=/\v\\./ end=/\v"""/

hi link fshString String
hi link fshStringTriple String

" Codes
syn region fshCode start=/\v#/ end=/\v($|\s)/
syn region fshCodeQuoted start=/\v#"/ end=/\v"/
hi link fshCode Constant
hi link fshCodeQuoted Constant

" Operators
syn match opEquals "\v\="
syn match opStar "\v\*"
syn match opColon "\v\:"
syn match opArrow "\v\-\>"
syn match opDot "\v\."
syn match opBracketLeft "\["
syn match opBracketRight "\]"
syn match opCarat "\^"

hi link opEquals Operator
hi link opStar Operator
hi link opColon Operator
hi link opArrow Operator
hi link opDot Operator
hi link opBracketLeft Operator
hi link opBracketRight Operator
hi link opCarat Operator

