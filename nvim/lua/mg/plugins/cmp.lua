return {
	{
		"saghen/blink.cmp",
		lazy = false,
		dependencies = { "rafamadriz/friendly-snippets", "kristijanhusak/vim-dadbod-completion" },
		version = "v0.*",
		opts = {
			cmdline = { enabled = false },
			completion = {
				documentation = { auto_show = true, auto_show_delay_ms = 500 },
			},
			keymap = {
				preset = "default",
				["<CR>"] = { "select_and_accept", "fallback" },
				["<C-h>"] = {
					function(cmp)
						cmp.show({ providers = { "lsp" } })
					end,
				},
				["<C-d>"] = { "show_documentation", "hide_documentation", "fallback" },
			},
			appearance = {
				-- Sets the fallback highlight groups to nvim-cmp's highlight groups
				-- Useful for when your theme doesn't support blink.cmp
				-- will be removed in a future release
				use_nvim_cmp_as_default = true,
				-- Set to 'mono' for 'Nerd Font Mono' or 'normal' for 'Nerd Font'
				-- Adjusts spacing to ensure icons are aligned
				nerd_font_variant = "mono",
			},

			-- default list of enabled providers defined so that you can extend it
			-- elsewhere in your config, without redefining it, via `opts_extend`
			sources = {
				default = { "lsp", "dadbod", "path", "snippets", "buffer" },
				providers = {
					dadbod = { name = "Dadbod", module = "vim_dadbod_completion.blink" },
				},
			},

			-- experimental signature help support
			signature = { enabled = false },
		},
		opts_extend = { "sources.default" },
	},
}
