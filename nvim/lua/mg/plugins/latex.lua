return {
	"lervag/vimtex",
	ft = { "tex", "plaintex" },
	config = function()
		vim.g.vimtex_view_method = "skim"
		vim.g.vimtex_view_skim_sync = 1
		vim.g.vimtex_view_skim_activate = 1
	end,
}
