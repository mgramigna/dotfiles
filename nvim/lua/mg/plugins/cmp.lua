return {
	{
		"saghen/blink.cmp",
		lazy = false,
		dependencies = { "rafamadriz/friendly-snippets", "kristijanhusak/vim-dadbod-completion" },
		version = "v0.*",
		opts = {
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
				-- optionally disable cmdline completions
				cmdline = {},
			},

			-- experimental signature help support
			signature = { enabled = false },
		},
		opts_extend = { "sources.default" },
	},
}

--return {
--	"hrsh7th/nvim-cmp",
--	event = { "InsertEnter" },
--	dependencies = {
--		"hrsh7th/cmp-nvim-lsp",
--		"hrsh7th/cmp-buffer",
--		"hrsh7th/cmp-path",
--		"L3MON4D3/LuaSnip",
--		"saadparwaiz1/cmp_luasnip",
--		"onsails/lspkind.nvim",
--		"rafamadriz/friendly-snippets",
--		"kristijanhusak/vim-dadbod-completion",
--		"david-kunz/cmp-npm",
--	},
--	config = function()
--		local cmp = require("cmp")
--		local lspkind = require("lspkind")

--		require("cmp-npm").setup({})

--		local default_mappings = cmp.mapping.preset.insert({
--			["<C-n>"] = cmp.mapping.select_next_item({ behavior = cmp.SelectBehavior.Insert }),
--			["<C-p>"] = cmp.mapping.select_prev_item({ behavior = cmp.SelectBehavior.Insert }),
--			["<C-y>"] = cmp.mapping.complete(),
--			["<CR>"] = cmp.mapping(
--				cmp.mapping.confirm({
--					behavior = cmp.ConfirmBehavior.Insert,
--					select = true,
--				}),
--				{ "i", "c" }
--			),
--			["<C-f>"] = cmp.mapping.scroll_docs(-4),
--			["<C-b>"] = cmp.mapping.scroll_docs(4),
--			["<C-x>"] = cmp.mapping.abort(),
--		})

--		cmp.setup({
--			snippet = {
--				expand = function(args)
--					require("luasnip").lsp_expand(args.body)
--				end,
--			},
--			window = {
--				completion = cmp.config.window.bordered(),
--				documentation = cmp.config.window.bordered(),
--			},
--			---@diagnostic disable-next-line: missing-fields
--			formatting = {
--				format = lspkind.cmp_format({
--					mode = "symbol",
--					menu = {
--						buffer = "[Buffer]",
--						nvim_lsp = "[LSP]",
--						luasnip = "[LuaSnip]",
--						nvim_lua = "[Lua]",
--						latex_symbols = "[Latex]",
--					},
--				}),
--			},
--			mapping = default_mappings,
--			sources = cmp.config.sources({
--				{ name = "nvim_lsp" },
--				{ name = "path" },
--				{
--					name = "luasnip",
--					entry_filter = function()
--						local context = require("cmp.config.context")
--						return not context.in_treesitter_capture("string") and not context.in_syntax_group("String")
--					end,
--				},
--			}, {
--				{ name = "buffer" },
--			}),
--		})

--		cmp.setup.filetype({ "sql" }, {
--			sources = {
--				{ name = "vim-dadbod-completion" },
--				{ name = "buffer" },
--			},
--		})

--		cmp.setup.filetype({ "json" }, {
--			sources = {
--				{ name = "npm", keyword_length = 4 },
--				{ name = "path" },
--				{ name = "buffer" },
--			},
--		})

--		-- https://github.com/hrsh7th/nvim-cmp/issues/2106
--		cmp.setup.filetype({ "rust" }, {
--			mapping = vim.tbl_extend("force", default_mappings, {
--				["<C-n>"] = cmp.mapping.select_next_item({ behavior = cmp.SelectBehavior.Select }),
--				["<C-p>"] = cmp.mapping.select_prev_item({ behavior = cmp.SelectBehavior.Select }),
--			}),
--		})

--		local ls = require("luasnip")
--		ls.config.set_config({
--			history = false,
--			updateevents = "TextChanged,TextChangedI",
--		})

--		vim.keymap.set({ "i", "s" }, "<C-k>", function()
--			if ls.expand_or_jumpable() then
--				ls.expand_or_jump()
--			end
--		end, { silent = true })

--		vim.keymap.set({ "i", "s" }, "<C-j>", function()
--			if ls.jumpable(-1) then
--				ls.jump(-1)
--			end
--		end, { silent = true })

--		require("luasnip.loaders.from_vscode").lazy_load({
--			paths = { "~/.local/share/nvim/lazy/friendly-snippets", "~/.config/nvim/snippets" },
--		})
--	end,
--}
