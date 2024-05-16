return {
	"hrsh7th/nvim-cmp",
	event = { "InsertEnter" },
	dependencies = {
		"hrsh7th/cmp-nvim-lsp",
		"hrsh7th/cmp-buffer",
		"hrsh7th/cmp-path",
		"L3MON4D3/LuaSnip",
		"saadparwaiz1/cmp_luasnip",
		"onsails/lspkind.nvim",
		"rafamadriz/friendly-snippets",
		"kristijanhusak/vim-dadbod-completion",
	},
	config = function()
		local cmp = require("cmp")
		local lspkind = require("lspkind")

		lspkind.init({})

		cmp.setup({
			snippet = {
				expand = function(args)
					require("luasnip").lsp_expand(args.body)
				end,
			},
			window = {
				completion = cmp.config.window.bordered(),
				documentation = cmp.config.window.bordered(),
			},
			mapping = cmp.mapping.preset.insert({
				["<C-n>"] = cmp.mapping.select_next_item({ behavior = cmp.SelectBehavior.Insert }),
				["<C-p>"] = cmp.mapping.select_prev_item({ behavior = cmp.SelectBehavior.Insert }),
				["<CR>"] = cmp.mapping(
					cmp.mapping.confirm({
						behavior = cmp.ConfirmBehavior.Insert,
						select = true,
					}),
					{ "i", "c" }
				),
				["<C-y>"] = cmp.mapping(
					cmp.mapping.confirm({
						behavior = cmp.ConfirmBehavior.Insert,
						select = true,
					}),
					{ "i", "c" }
				),
				["<C-f>"] = cmp.mapping.scroll_docs(-4),
				["<C-b>"] = cmp.mapping.scroll_docs(4),
				["<C-x>"] = cmp.mapping.abort(),
			}),
			sources = cmp.config.sources({
				{ name = "nvim_lsp" },
				{ name = "path" },
				{
					name = "luasnip",
					entry_filter = function()
						local context = require("cmp.config.context")
						return not context.in_treesitter_capture("string") and not context.in_syntax_group("String")
					end,
				},
			}, {
				{ name = "buffer" },
			}),
			formatting = {
				format = lspkind.cmp_format({
					mode = "symbol",
					maxwidth = 50,
				}),
			},
		})

		cmp.setup.filetype({ "sql" }, {
			sources = {
				{ name = "vim-dadbod-completion" },
				{ name = "buffer" },
			},
		})

		local ls = require("luasnip")
		ls.config.set_config({
			history = false,
			updateevents = "TextChanged,TextChangedI",
		})

		vim.keymap.set({ "i", "s" }, "<C-k>", function()
			if ls.expand_or_jumpable() then
				ls.expand_or_jump()
			end
		end, { silent = true })

		vim.keymap.set({ "i", "s" }, "<C-j>", function()
			if ls.jumpable(-1) then
				ls.jump(-1)
			end
		end, { silent = true })

		require("luasnip.loaders.from_vscode").lazy_load({
			paths = { "~/.local/share/nvim/lazy/friendly-snippets", "~/.config/nvim/snippets" },
		})
	end,
}
