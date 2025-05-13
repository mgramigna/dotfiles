return {
	{
		"williamboman/mason.nvim",
		opts = {},
	},
	{
		"neovim/nvim-lspconfig",
		event = "BufRead",
		dependencies = {
			{
				"mrcjkb/rustaceanvim",
				version = "^5",
				ft = { "rust" },
			},
			{
				"marilari88/twoslash-queries.nvim",
				config = function()
					require("twoslash-queries").setup({
						multi_line = true,
					})

					vim.keymap.set("n", "<leader>ti", "<cmd>TwoslashQueriesInspect<cr>", { noremap = true })
				end,
			},
			{
				"j-hui/fidget.nvim",
				opts = {},
			},
			{
				"folke/lazydev.nvim",
				ft = "lua",
				opts = {
					library = {
						-- See the configuration section for more details
						-- Load luvit types when the `vim.uv` word is found
						{ path = "${3rd}/luv/library", words = { "vim%.uv" } },
					},
				},
			},
			{ "saghen/blink.cmp" },
			{ "yioneko/nvim-vtsls" }
		},
		config = function()
			local diagnostic_icons = {
				Error = "󰅚 ",
				Warn = "󰀪 ",
				Info = "•",
				Hint = "•",
			}

			vim.diagnostic.config({
				float = {
					source = true,
					severity_sort = true,
				},
				jump = {
					severity = { min = vim.diagnostic.severity.W },
				},
				virtual_text = {
					severity = { min = vim.diagnostic.severity.HINT },
				},
				underline = true,
				severity_sort = true,
				signs = {
					text = {
						[vim.diagnostic.severity.ERROR] = diagnostic_icons.Error,
						[vim.diagnostic.severity.WARN] = diagnostic_icons.Warn,
						[vim.diagnostic.severity.INFO] = diagnostic_icons.Info,
						[vim.diagnostic.severity.HINT] = diagnostic_icons.Hint,
					},
					numhl = {
						[vim.diagnostic.severity.ERROR] = "DiagnosticSignError",
						[vim.diagnostic.severity.WARN] = "DiagnosticSignWarn",
					},
				},
			})

			vim.api.nvim_create_autocmd("LspAttach", {
				group = vim.api.nvim_create_augroup("MgLspConfig", {}),
				callback = function(ev)
					local opts = { noremap = true, silent = true, buffer = ev.buf }

					vim.keymap.set("n", "gD", vim.lsp.buf.declaration, opts)
					vim.keymap.set("n", "gd", vim.lsp.buf.definition, opts)
					vim.keymap.set("n", "gi", vim.lsp.buf.implementation, opts)
					vim.keymap.set("n", "gt", vim.lsp.buf.type_definition, opts)
					vim.keymap.set("n", "<leader>rn", vim.lsp.buf.rename, opts)

					vim.keymap.set("n", "gr", function()
						require("telescope.builtin").lsp_references()
					end, opts)

					vim.keymap.set("n", "<leader>e", vim.diagnostic.open_float)
					vim.keymap.set("n", "[g", function()
						vim.diagnostic.jump({ count = -1, float = true })
					end)
					vim.keymap.set("n", "]g", function()
						vim.diagnostic.jump({ count = 1, float = true })
					end)
					vim.keymap.set("n", "K", vim.lsp.buf.hover, opts)
					vim.keymap.set("n", "<leader>do", vim.lsp.buf.code_action, opts)

					vim.keymap.set("n", "<leader>ef", function()
						vim.cmd("LspEslintFixAll")
					end, { noremap = true })

					local eslint_group = vim.api.nvim_create_augroup("EslintFix", { clear = true })

					vim.api.nvim_create_autocmd("BufWritePre", {
						group = eslint_group,
						callback = function()
							if vim.fn.exists(":LspEslintFixAll") > 0 then
								vim.cmd("LspEslintFixAll")
							end
						end,
					})
				end,
			})

			local capabilities = require("blink.cmp").get_lsp_capabilities()

			vim.lsp.config("*", {
				capabilities = capabilities
			})

			vim.lsp.config("vtsls", {
				settings = {
					maxTsServerMemory = 12288,
				},
			})

			vim.lsp.enable({
				"astro",
				"eslint",
				"jdtls",
				"lua_ls",
				"prismals",
				"pylsp",
				"rust_analyzer",
				"tailwindcss",
				"texlab",
				"vtsls"
			})
		end,
	},
}
